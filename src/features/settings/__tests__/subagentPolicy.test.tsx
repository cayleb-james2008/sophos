// subagentPolicy.test.tsx — SubagentPolicyPanel renders correctly and persists
// its provider / model / thinking selections via setSettings. Mocks the IPC
// client and the useModels catalog so the panel runs against controllable data.

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SubagentPolicyPanel } from "../SubagentPolicyPanel";

const mockClient = vi.hoisted(() => ({
  getSettings: vi.fn(),
  setSettings: vi.fn(),
  getRuntimeInfo: vi.fn(),
}));

const mockModels = vi.hoisted(() => {
  const providers = [
    { id: "ollama-cloud", name: "Ollama Cloud", kind: "api_key", connected: true, models: [] },
    { id: "openrouter", name: "OpenRouter", kind: "api_key", connected: true, models: [] },
  ];
  return {
    providers,
    models: [
      { id: "deepseek-v4-flash:0731-cloud", name: "DeepSeek V4 Flash 0731", provider: "ollama-cloud" },
      { id: "gpt-4o", name: "GPT-4o", provider: "openrouter" },
    ],
    loading: false,
    error: null,
    reload: vi.fn(),
  };
});

vi.mock("../../../ipc/client", async () => ({
  useIpc: () => mockClient,
  useIpcEvent: () => undefined,
  useConnectionState: () => ({ status: { kind: "connected" }, model: { provider: "p", model: "m" } }),
}));

vi.mock("../../providers/useModels", async () => ({
  useModels: () => mockModels,
}));

const DEFAULT_PROVIDERS = [
  { id: "ollama-cloud", name: "Ollama Cloud", kind: "api_key", connected: true, models: [] },
  { id: "openrouter", name: "OpenRouter", kind: "api_key", connected: true, models: [] },
];

const savedSettings = {
  subagentDefaultProvider: "ollama-cloud",
  subagentDefaultModel: "deepseek-v4-flash:0731-cloud",
  subagentDefaultThinking: "low",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockModels.providers.splice(0, mockModels.providers.length, ...DEFAULT_PROVIDERS);
  (mockClient.getSettings as ReturnType<typeof vi.fn>).mockResolvedValue({ ...savedSettings });
  (mockClient.setSettings as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
});

describe("SubagentPolicyPanel", () => {
  it("renders provider, model, and thinking selects with the saved defaults", async () => {
    render(<SubagentPolicyPanel />);

    await waitFor(() => expect(screen.getByLabelText("Provider")).toBeInTheDocument());

    const provider = screen.getByLabelText("Provider") as HTMLSelectElement;
    const model = screen.getByLabelText("Model") as HTMLSelectElement;
    const thinking = screen.getByLabelText("Thinking level") as HTMLSelectElement;

    expect(provider.value).toBe("ollama-cloud");
    expect(model.value).toBe("deepseek-v4-flash:0731-cloud");
    expect(thinking.value).toBe("low");

    // The model list is filtered to the selected provider's models.
    const modelOptions = Array.from(model.options).map((o) => o.value);
    expect(modelOptions).toContain("deepseek-v4-flash:0731-cloud");
    expect(modelOptions).not.toContain("gpt-4o");
  });

  it("persists a new thinking level via setSettings with the exact payload", async () => {
    render(<SubagentPolicyPanel />);

    await waitFor(() => expect(screen.getByLabelText("Thinking level")).toBeInTheDocument());

    const thinking = screen.getByLabelText("Thinking level");
    await userEvent.selectOptions(thinking, "high");

    await waitFor(() => {
      expect(mockClient.setSettings).toHaveBeenCalledWith({
        subagentDefaultProvider: "ollama-cloud",
        subagentDefaultModel: "deepseek-v4-flash:0731-cloud",
        subagentDefaultThinking: "high",
      });
    });
  });

  it("persists a provider change and filters the model list to it", async () => {
    render(<SubagentPolicyPanel />);

    await waitFor(() => expect(screen.getByLabelText("Provider")).toBeInTheDocument());

    const provider = screen.getByLabelText("Provider");
    await userEvent.selectOptions(provider, "openrouter");

    await waitFor(() => {
      expect(mockClient.setSettings).toHaveBeenCalledWith(
        expect.objectContaining({ subagentDefaultProvider: "openrouter" }),
      );
    });

    // After re-render the model list now offers the new provider's models.
    const model = screen.getByLabelText("Model") as HTMLSelectElement;
    const modelOptions = Array.from(model.options).map((o) => o.value);
    expect(modelOptions).toContain("gpt-4o");
  });

  it("shows a helpful empty state when no providers are configured", async () => {
    mockModels.providers.length = 0;
    (mockClient.getSettings as ReturnType<typeof vi.fn>).mockResolvedValue({});

    render(<SubagentPolicyPanel />);

    await waitFor(() => {
      expect(screen.getByText(/No providers configured/i)).toBeInTheDocument();
    });
  });

  it("surfaces a load error with a retry that re-invokes load and clears the error", async () => {
    (mockClient.getSettings as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("settings down"));

    render(<SubagentPolicyPanel />);

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByText(/settings down/i)).toBeInTheDocument();

    // Retry now succeeds: load re-runs, the error clears, and the form appears.
    (mockClient.getSettings as ReturnType<typeof vi.fn>).mockResolvedValue({ ...savedSettings });
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));

    await waitFor(() => expect(screen.getByLabelText("Provider")).toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(mockClient.getSettings).toHaveBeenCalledTimes(2);
  });

  it("surfaces the full error block + retry even when a saved policy exists", async () => {
    // Settings load succeeds (a policy exists), then a save fails — the error
    // must still surface as the full block + retry, not a trailing micro-text.
    (mockClient.setSettings as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("save failed"));

    render(<SubagentPolicyPanel />);

    await waitFor(() => expect(screen.getByLabelText("Provider")).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByLabelText("Thinking level"), "high");

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByText(/save failed/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});
