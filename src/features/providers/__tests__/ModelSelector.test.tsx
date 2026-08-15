// ModelSelector — custom model dropdown. Mocks ipc/client (connection state)
// and ../useModels (catalog + selection actions) so grouping, selection, and
// thinking-level rendering are exercised against controllable data.

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModelSelector } from "../ModelSelector";

const mockState = vi.hoisted(() => ({
  model: undefined as any,
}));

const mockModels = vi.hoisted(() => {
  const providers = [
    { id: "ollama-cloud", name: "Ollama Cloud", kind: "subscription", connected: true, models: [] },
    { id: "minimax", name: "MiniMax", kind: "api_key", connected: true, models: [] },
  ];
  return {
    providers,
    models: [
      { id: "deepseek-v4-flash:0731-cloud", name: "DeepSeek V4 Flash", provider: "ollama-cloud", contextWindow: 1000000, supportsThinking: true },
      { id: "minimax-m3", name: "MiniMax M3", provider: "minimax", contextWindow: 524288, supportsThinking: false },
    ],
    loading: false,
    error: null as string | null,
    setModel: vi.fn(),
    thinking: "high",
    setThinking: vi.fn(),
    thinkingLevels: [
      { value: "off", label: "Off" },
      { value: "low", label: "Low" },
      { value: "high", label: "High" },
    ],
  };
});

vi.mock("../../../ipc/client", () => ({
  useConnectionState: () => ({ model: mockState.model }),
}));

vi.mock("../useModels", () => ({
  useModels: () => mockModels,
  DEFAULT_PROVIDER: "ollama-cloud",
  DEFAULT_MODEL: "deepseek-v4-flash:0731-cloud",
}));

const DEFAULT_PROVIDERS = [
  { id: "ollama-cloud", name: "Ollama Cloud", kind: "subscription", connected: true, models: [] },
  { id: "minimax", name: "MiniMax", kind: "api_key", connected: true, models: [] },
];

const DEFAULT_MODELS = [
  { id: "deepseek-v4-flash:0731-cloud", name: "DeepSeek V4 Flash", provider: "ollama-cloud", contextWindow: 1000000, supportsThinking: true },
  { id: "minimax-m3", name: "MiniMax M3", provider: "minimax", contextWindow: 524288, supportsThinking: false },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockState.model = { provider: "ollama-cloud", model: "deepseek-v4-flash:0731-cloud", thinking: "high" };
  mockModels.providers.splice(0, mockModels.providers.length, ...DEFAULT_PROVIDERS);
  mockModels.models.splice(0, mockModels.models.length, ...DEFAULT_MODELS);
  mockModels.loading = false;
  mockModels.error = null;
  (mockModels.setModel as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (mockModels.setThinking as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
});

describe("ModelSelector", () => {
  it("renders the trigger with the current provider and model name", () => {
    render(<ModelSelector />);
    expect(screen.getByText("ollama-cloud")).toBeInTheDocument();
    expect(screen.getByText("DeepSeek V4 Flash")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /deepseek v4 flash/i })).toHaveAttribute("aria-expanded", "false");
  });

  it("opens the listbox and groups models by provider", async () => {
    const user = userEvent.setup();
    render(<ModelSelector />);
    await user.click(screen.getByRole("button", { name: /deepseek v4 flash/i }));

    expect(screen.getByRole("listbox", { name: /model selector/i })).toBeInTheDocument();
    expect(screen.getByText("Ollama Cloud")).toBeInTheDocument();
    expect(screen.getByText("MiniMax")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /deepseek v4 flash/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /minimax m3/i })).toBeInTheDocument();
  });

  it("selects a different model and calls setModel with the current thinking level", async () => {
    const user = userEvent.setup();
    render(<ModelSelector />);
    await user.click(screen.getByRole("button", { name: /deepseek v4 flash/i }));

    await user.click(screen.getByRole("option", { name: /minimax m3/i }));
    expect(mockModels.setModel).toHaveBeenCalledWith("minimax", "minimax-m3", "high");
  });

  it("closes without calling setModel when the current model is reselected", async () => {
    const user = userEvent.setup();
    render(<ModelSelector />);
    await user.click(screen.getByRole("button", { name: /deepseek v4 flash/i }));

    await user.click(screen.getByRole("option", { name: /deepseek v4 flash/i }));
    expect(mockModels.setModel).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("shows a loading state while the catalog loads", async () => {
    mockModels.loading = true;
    const user = userEvent.setup();
    render(<ModelSelector />);
    await user.click(screen.getByRole("button", { name: /deepseek v4 flash/i }));
    expect(screen.getByText(/loading catalog/i)).toBeInTheDocument();
  });

  it("surfaces a catalog error", async () => {
    mockModels.error = "catalog down";
    const user = userEvent.setup();
    render(<ModelSelector />);
    await user.click(screen.getByRole("button", { name: /deepseek v4 flash/i }));
    expect(screen.getByText("catalog down")).toBeInTheDocument();
  });

  it("shows an empty state when no models are available", async () => {
    mockModels.models.length = 0;
    mockModels.providers.length = 0;
    const user = userEvent.setup();
    render(<ModelSelector />);
    await user.click(screen.getByRole("button", { name: /ollama-cloud/i }));
    expect(screen.getByText(/no models available/i)).toBeInTheDocument();
  });

  it("renders the thinking-level select for a thinking-capable current model and persists changes", async () => {
    const user = userEvent.setup();
    render(<ModelSelector />);
    await user.click(screen.getByRole("button", { name: /deepseek v4 flash/i }));

    expect(screen.getByText(/thinking level/i)).toBeInTheDocument();
    const select = screen.getByDisplayValue("High");
    await user.selectOptions(select, "low");
    expect(mockModels.setThinking).toHaveBeenCalledWith("low");
    await waitFor(() => expect(mockModels.setModel).toHaveBeenCalledWith("ollama-cloud", "deepseek-v4-flash:0731-cloud", "low"));
  });

  it("falls back to defaults when connection state reports no model", () => {
    mockState.model = undefined;
    render(<ModelSelector />);
    expect(screen.getByText("ollama-cloud")).toBeInTheDocument();
    expect(screen.getByText("DeepSeek V4 Flash")).toBeInTheDocument();
  });
});
