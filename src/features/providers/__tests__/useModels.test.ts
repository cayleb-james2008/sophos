// useModels — hook tests. Mocks the IPC layer so the model/provider catalog
// loads and selects against a controllable client. Runs in the Tauri path so a
// local (browser-only) model is never appended to the catalog.

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useModels } from "../useModels";

type AnyFn = (...args: never[]) => unknown;

const mockState = vi.hoisted(() => {
  return {
    client: {
      getProviders: vi.fn(),
      getModels: vi.fn(),
      getSettings: vi.fn(),
      setSettings: vi.fn(),
      setModel: vi.fn(),
    } as Record<string, AnyFn>,
  };
});

vi.mock("../../../ipc/client", () => ({
  useIpc: () => mockState.client,
  isTauri: true,
}));

const providers = [
  { id: "ollama-cloud", name: "Ollama Cloud", kind: "subscription", connected: true, models: [] },
];
const models = [
  { id: "deepseek-v4-flash:0731-cloud", name: "DeepSeek V4 Flash", provider: "ollama-cloud", contextWindow: 1000000, maxOutputTokens: 65536, maxContextWindow: 1000000, maxOutputTokensCeiling: 65536, supportsThinking: true },
  { id: "minimax-m3", name: "MiniMax M3", provider: "minimax", contextWindow: 524288, maxOutputTokens: 128000, maxContextWindow: 524288, maxOutputTokensCeiling: 128000 },
];

function makeClient() {
  (mockState.client.getProviders as ReturnType<typeof vi.fn>).mockResolvedValue(providers);
  (mockState.client.getModels as ReturnType<typeof vi.fn>).mockResolvedValue(models);
  (mockState.client.getSettings as ReturnType<typeof vi.fn>).mockResolvedValue({ modelConfig: {}, defaultThinking: "high" });
  (mockState.client.setSettings as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (mockState.client.setModel as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
}

beforeEach(() => {
  makeClient();
});

describe("useModels", () => {
  it("loads the provider/model catalog and applies saved thinking level", async () => {
    const { result } = renderHook(() => useModels());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.providers).toHaveLength(1);
    expect(result.current.models).toHaveLength(2);
    expect(result.current.error).toBeNull();
    expect(result.current.thinking).toBe("high");
  });

  it("surfaces an error when the catalog load fails", async () => {
    (mockState.client.getProviders as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("catalog down"));
    const { result } = renderHook(() => useModels());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("catalog down");
    expect(result.current.models).toEqual([]);
  });

  it("reload refreshes the catalog after a failure", async () => {
    (mockState.client.getProviders as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("catalog down"));
    const { result } = renderHook(() => useModels());
    await waitFor(() => expect(result.current.error).toBe("catalog down"));

    await act(async () => {
      await result.current.reload();
    });
    await waitFor(() => expect(result.current.error).toBeNull());
    expect(result.current.models).toHaveLength(2);
  });

  it("setModel pushes the selection to the IPC layer", async () => {
    const { result } = renderHook(() => useModels());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.setModel("ollama-cloud", "deepseek-v4-flash:0731-cloud", "medium");
    });
    expect(mockState.client.setModel).toHaveBeenCalledWith("ollama-cloud", "deepseek-v4-flash:0731-cloud", "medium");
  });

  it("setModel failure surfaces an error without throwing", async () => {
    (mockState.client.setModel as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("select failed"));
    const { result } = renderHook(() => useModels());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.setModel("ollama-cloud", "deepseek-v4-flash:0731-cloud");
    });
    expect(result.current.error).toBe("select failed");
  });

  it("setModelConfig optimistically updates the local catalog and persists the override", async () => {
    const { result } = renderHook(() => useModels());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.setModelConfig("ollama-cloud", "deepseek-v4-flash:0731-cloud", { contextWindow: 200000 });
    });
    const updated = result.current.models.find((m) => m.id === "deepseek-v4-flash:0731-cloud");
    expect(updated?.contextWindow).toBe(200000);
    expect(mockState.client.setSettings).toHaveBeenCalled();
    expect(mockState.client.setModel).toHaveBeenCalled();
  });
});
