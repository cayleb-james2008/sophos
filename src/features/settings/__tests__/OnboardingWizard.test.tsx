// OnboardingWizard.test.tsx — OnboardingWizard walks Welcome → Provider → Model
// → First prompt, skippable at every step, and wires model selection to
// useModels.setModel.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OnboardingWizard } from "../OnboardingWizard";
import type { OnboardingStatus } from "../FirstRunBanner";

const mockClient = vi.hoisted(() => ({}));
const mockConn = vi.hoisted(() => ({
  status: { kind: "connected" as const },
  model: { provider: "ollama-cloud", model: "deepseek-v4-flash:0731-cloud" },
}));
const mockModels = vi.hoisted(() => ({
  providers: [{ id: "ollama-cloud", name: "Ollama Cloud", connected: true }],
  models: [
    { id: "deepseek-v4-flash:0731-cloud", name: "DeepSeek V4 Flash 0731", provider: "ollama-cloud", contextWindow: 1000000 },
  ],
  loading: false,
  error: null,
  reload: vi.fn(),
  setModel: vi.fn(),
}));
const tauriFlag = vi.hoisted(() => ({ value: false }));

vi.mock("../../../ipc/client", async () => ({
  useIpc: () => mockClient,
  useIpcEvent: () => undefined,
  useConnectionState: () => mockConn,
  get isTauri() {
    return tauriFlag.value;
  },
  isDemoShell: () => false,
  isDemoMode: () => !tauriFlag.value,
}));

vi.mock("../../providers/useModels", async () => ({
  useModels: () => mockModels,
  DEFAULT_PROVIDER: "ollama-cloud",
  DEFAULT_MODEL: "deepseek-v4-flash:0731-cloud",
}));

function makeSetup(overrides: Partial<OnboardingStatus> = {}): OnboardingStatus {
  return {
    checks: ["Node runtime", "Daemon", "Bridge", "Kernel", "Free model"].map((label) => ({
      label,
      state: "ready",
      detail: "Ready",
    })),
    ready: true,
    hasProvider: true,
    hasFreeProvider: true,
    refresh: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  mockConn.model = { provider: "ollama-cloud", model: "deepseek-v4-flash:0731-cloud" };
  tauriFlag.value = false;
});

describe("OnboardingWizard", () => {
  it("walks through all four steps and starts chat at the end", async () => {
    const user = userEvent.setup();
    const onStartChat = vi.fn();
    render(<OnboardingWizard setup={makeSetup()} onStartChat={onStartChat} />);

    // Welcome
    expect(screen.getByRole("heading", { name: /quieter way to think/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /get started/i }));

    // Provider step (provider already connected)
    expect(screen.getByText(/Step 2 of 4/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^next$/i }));

    // Model step (a model is already selected)
    expect(screen.getByText(/Step 3 of 4/)).toBeInTheDocument();
    expect(screen.getByText("DeepSeek V4 Flash 0731")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^next$/i }));

    // First prompt step
    expect(screen.getByText(/Step 4 of 4/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /start chatting/i }));

    expect(onStartChat).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("lets the user go back a step", async () => {
    const user = userEvent.setup();
    render(<OnboardingWizard setup={makeSetup()} />);

    await user.click(screen.getByRole("button", { name: /get started/i }));
    expect(screen.getByText(/Step 2 of 4/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^back$/i }));
    expect(screen.getByRole("heading", { name: /quieter way to think/i })).toBeInTheDocument();
  });

  it("skips the wizard and persists the dismiss flag", async () => {
    const user = userEvent.setup();
    render(<OnboardingWizard setup={makeSetup()} />);

    await user.click(screen.getByRole("button", { name: /skip for now/i }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(window.localStorage.getItem("sophos.onboardingDismissed.v1")).toBe("1");
  });

  it("renders nothing when a first message already exists", () => {
    const { container } = render(<OnboardingWizard setup={makeSetup()} hasFirstMessage />);
    expect(container.firstChild).toBeNull();
  });

  it("selects a model from the list when none is currently selected", async () => {
    const user = userEvent.setup();
    mockConn.model = undefined as never;
    mockModels.models = [
      { id: "other-model", name: "Other Model", provider: "ollama-cloud", contextWindow: 1000 },
    ];
    render(<OnboardingWizard setup={makeSetup()} />);

    await user.click(screen.getByRole("button", { name: /get started/i }));
    await user.click(screen.getByRole("button", { name: /^next$/i }));

    expect(screen.getByRole("listbox", { name: /available models/i })).toBeInTheDocument();
    const option = screen.getByRole("option", { name: /Other Model/i });
    await user.click(option);

    expect(mockModels.setModel).toHaveBeenCalledWith("ollama-cloud", "other-model");
  });
});
