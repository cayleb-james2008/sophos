// ProvidersPanel.test.tsx — ProvidersPanel renders the provider catalog, opens
// the OAuth/API-key login modal for cloud providers, expands a model into its
// runtime-config adjuster, and connects local endpoints — all wired to the IPC
// client and useModels.

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProvidersPanel } from "../ProvidersPanel";

const mockClient = vi.hoisted(() => ({
  getSettings: vi.fn(),
  setSettings: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
}));

const mockModels = vi.hoisted(() => {
  const providers = [
    { id: "ollama-cloud", name: "Ollama Cloud", kind: "api_key", connected: true, models: [] },
    { id: "openrouter", name: "OpenRouter", kind: "subscription", connected: false, models: [] },
  ];
  const models = [
    {
      id: "deepseek-v4-flash:0731-cloud",
      name: "DeepSeek V4 Flash 0731",
      provider: "ollama-cloud",
      contextWindow: 1000000,
      maxOutputTokens: 65536,
      maxContextWindow: 1000000,
      maxOutputTokensCeiling: 65536,
      supportsThinking: true,
    },
  ];
  return {
    providers,
    models,
    loading: false,
    error: null,
    reload: vi.fn(),
    setModel: vi.fn(),
    setModelConfig: vi.fn(),
    resetModelConfig: vi.fn(),
    thinking: "xhigh",
    setThinking: vi.fn(),
    thinkingLevels: [],
  };
});

vi.mock("../../../ipc/client", async () => ({
  isTauri: false,
  useIpc: () => mockClient,
  useIpcEvent: () => undefined,
  useConnectionState: () => ({ status: { kind: "connected" } }),
}));

vi.mock("../../providers/useModels", async () => ({
  useModels: () => mockModels,
  modelKey: (p: string, m: string) => `${p}:${m}`,
}));

const DEFAULT_PROVIDERS = [
  { id: "ollama-cloud", name: "Ollama Cloud", kind: "api_key", connected: true, models: [] },
  { id: "openrouter", name: "OpenRouter", kind: "subscription", connected: false, models: [] },
];

function jsonResponse(value: unknown): Response {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let read = false;
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: {
      getReader: () => ({
        read: async () => {
          if (read) return { done: true, value: undefined };
          read = true;
          return { done: false, value: bytes };
        },
        releaseLock: () => undefined,
        cancel: async () => undefined,
      }),
    },
  } as unknown as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockModels.providers.splice(0, mockModels.providers.length, ...DEFAULT_PROVIDERS);
  (mockClient.getSettings as ReturnType<typeof vi.fn>).mockResolvedValue({ localProviders: [] });
  (mockClient.setSettings as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (mockClient.login as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (mockClient.logout as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
});

describe("ProvidersPanel", () => {
  it("renders each provider card with its name, id, kind badge, and connection state", async () => {
    render(<ProvidersPanel />);

    await waitFor(() => expect(screen.getByText("Ollama Cloud")).toBeInTheDocument());
    expect(screen.getByText("OpenRouter")).toBeInTheDocument();
    expect(screen.getByText("ollama-cloud")).toBeInTheDocument();
    expect(screen.getAllByText("Configured")[0]).toBeInTheDocument();
    // "Offline" appears for both the disconnected cloud provider and the unconnected local card.
    expect(screen.getAllByText("Not configured").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("API key")).toBeInTheDocument();
    expect(screen.getByText("Managed")).toBeInTheDocument();
  });

  it("opens the login modal for an offline provider and calls ipc.login on submit", async () => {
    const user = userEvent.setup();
    render(<ProvidersPanel />);
    await waitFor(() => expect(screen.getByText("OpenRouter")).toBeInTheDocument());

    // Local card is index 0, openrouter (offline) is the second Connect button.
    const connectButtons = screen.getAllByRole("button", { name: /^connect$/i });
    await user.click(connectButtons[1]);

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByText(/Sign in with OAuth/i)).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Connect" })).toBeDisabled();
    await user.type(within(dialog).getByLabelText("API key"), "fixture-key");

    await user.click(within(dialog).getByRole("button", { name: "Connect" }));

    await waitFor(() => expect(mockClient.login).toHaveBeenCalledWith("openrouter", "fixture-key"));
    expect(mockModels.reload).toHaveBeenCalled();
  });

  it("keeps the key modal open and reports a save failure", async () => {
    const user = userEvent.setup();
    mockClient.login.mockRejectedValue(new Error("private detail"));
    render(<ProvidersPanel />);
    await user.click(screen.getAllByRole("button", { name: /^connect$/i })[1]);
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("API key"), "fixture-key");
    await user.click(within(dialog).getByRole("button", { name: "Connect" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save the API key");
    expect(mockModels.reload).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("expands a model row and applies a runtime config via setModelConfig", async () => {
    const user = userEvent.setup();
    render(<ProvidersPanel />);
    await waitFor(() => expect(screen.getByText("Ollama Cloud")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /DeepSeek V4 Flash/i }));
    expect(screen.getByText(/Runtime config/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /apply to model/i }));

    await waitFor(() => {
      expect(mockModels.setModelConfig).toHaveBeenCalledWith(
        "ollama-cloud",
        "deepseek-v4-flash:0731-cloud",
        expect.objectContaining({ contextWindow: 1000000, maxOutputTokens: 65536 }),
      );
    });
  });

  it("logs out of a connected provider via ipc.logout and reloads", async () => {
    const user = userEvent.setup();
    render(<ProvidersPanel />);
    await waitFor(() => expect(screen.getByText("Ollama Cloud")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /log out/i }));

    await waitFor(() => expect(mockClient.logout).toHaveBeenCalledWith("ollama-cloud"));
    expect(mockModels.reload).toHaveBeenCalled();
  });

  it("removes only the selected local endpoint when logging out", async () => {
    const user = userEvent.setup();
    const endpoints = [
      { id: "first", name: "First", kind: "ollama", baseUrl: "http://localhost:11434/v1" },
      { id: "second", name: "Second", kind: "ollama", baseUrl: "http://localhost:11435/v1" },
    ];
    mockClient.getSettings.mockResolvedValue({ localProviders: endpoints });
    render(<ProvidersPanel />);
    await screen.findByText("First");
    await user.click(screen.getAllByRole("button", { name: /log out/i })[0]);
    expect(mockClient.setSettings).toHaveBeenCalledWith({ localProviders: [endpoints[1]] });
  });

  it("connects a local endpoint from the local card modal", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ models: [{ name: "qwen:7b" }] })));
    render(<ProvidersPanel />);
    await waitFor(() => expect(screen.getByText(/Not connected/i)).toBeInTheDocument());

    // First Connect button is the Local card.
    await user.click(screen.getAllByRole("button", { name: /^connect$/i })[0]);

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Connect Local Model")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Connect" }));

    await waitFor(() =>
      expect(mockClient.setSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          localProviders: [
            expect.objectContaining({
              id: "local",
              baseUrl: "http://localhost:11434/v1",
              models: [expect.objectContaining({ id: "qwen:7b" })],
            }),
          ],
        }),
      ),
    );
    expect(mockClient.login).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
