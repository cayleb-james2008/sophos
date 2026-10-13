import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { ModelSelector } from "../ModelSelector";

const ipc = vi.hoisted(() => ({ getSettings: vi.fn(), setSettings: vi.fn(), setModel: vi.fn() }));
vi.mock("../../../ipc/client", () => ({
  isTauri: true,
  useIpc: () => ipc,
  useConnectionState: () => ({ model: { provider: "cloud", model: "cloud-model" } }),
}));
vi.mock("../useModels", () => ({
  DEFAULT_PROVIDER: "cloud",
  DEFAULT_MODEL: "cloud-model",
  useModels: () => ({
    providers: [],
    models: [],
    loading: false,
    error: null,
    setModel: ipc.setModel,
    thinkingLevels: [],
    setThinking: vi.fn(),
  }),
}));
vi.mock("../localDetection", async () => ({
  ...(await vi.importActual("../localDetection")),
  scanLocalEndpoints: async () => [
    {
      id: "sophos-local-ollama",
      kind: "ollama",
      name: "Ollama",
      port: 11434,
      baseUrl: "http://127.0.0.1:11434",
      models: [{ id: "qwen", name: "Qwen" }],
    },
  ],
}));

it("replaces the selected local catalog without deleting another configured server", async () => {
  const other = {
    id: "sophos-local-lm-studio",
    name: "LM Studio",
    kind: "openai-compatible",
    baseUrl: "http://127.0.0.1:1234/v1",
    models: [{ id: "other", name: "Other" }],
  };
  ipc.getSettings.mockResolvedValue({
    localProviders: [
      other,
      {
        id: "sophos-local-ollama",
        name: "Old Ollama",
        kind: "ollama",
        baseUrl: "http://127.0.0.1:11434/v1",
        models: [],
      },
    ],
  });
  ipc.setSettings.mockResolvedValue(undefined);
  ipc.setModel.mockResolvedValue(undefined);
  const user = userEvent.setup();
  render(<ModelSelector />);
  await user.click(screen.getByRole("button", { name: /cloud-model/i }));
  await user.click(await screen.findByRole("option", { name: /Qwen/i }));
  await waitFor(() => expect(ipc.setModel).toHaveBeenCalledWith("sophos-local-ollama", "qwen", undefined));
  const providers = ipc.setSettings.mock.calls[0][0].localProviders;
  expect(providers).toHaveLength(2);
  expect(providers[0]).toEqual(other);
  expect(providers[1].models).toEqual([{ id: "qwen", name: "Qwen" }]);
});
