// ModelSelector — component tests. We mock useConnectionState (for the current
// model selection) and useModels (for the catalog, hooks, and actions) so we
// can control supportsThinking / supportsFast per test. Asserts the inline
// thinking selector and fast-mode toggle render at rest (without opening the
// dropdown), respect the model's capability flags, the fast toggle calls
// setFastMode, and the old in-panel thinking block is gone.

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ThinkingLevel } from "../useModels";

// ── Mock state ──
// lifted so the vi.mock factories can reference it.
const mockState = vi.hoisted(() => {
  return {
    connection: {
      status: { kind: "connected" as const },
      model: {
        provider: "ollama-cloud",
        model: "deepseek-v4-flash:0731-cloud",
        thinking: "xhigh" as ThinkingLevel,
      },
    },
    modelsReturn: {
      providers: [{ id: "ollama-cloud", name: "Ollama Cloud", kind: "subscription" as const, connected: true, models: [] }],
      models: [] as Array<{
        id: string;
        name: string;
        provider: string;
        contextWindow: number;
        maxOutputTokens: number;
        supportsThinking?: boolean;
        supportsFast?: boolean;
      }>,
      loading: false,
      error: null as string | null,
      setModel: vi.fn(),
      thinking: "xhigh" as ThinkingLevel,
      setThinking: vi.fn(),
      thinkingLevels: [
        { value: "off", label: "Off" },
        { value: "minimal", label: "Minimal" },
        { value: "low", label: "Low" },
        { value: "medium", label: "Medium" },
        { value: "high", label: "High" },
        { value: "xhigh", label: "Extra High" },
        { value: "max", label: "Max" },
      ] as Array<{ value: ThinkingLevel; label: string }>,
      fastMode: false,
      setFastMode: vi.fn(),
    },
  };
});

vi.mock("../../../ipc/client", () => ({
  useConnectionState: () => mockState.connection,
  useIpc: () => ({}),
  isTauri: true,
}));

vi.mock("../useModels", () => ({
  ...mockState.modelsReturn,
  DEFAULT_PROVIDER: "ollama-cloud",
  DEFAULT_MODEL: "deepseek-v4-flash:0731-cloud",
  useModels: () => mockState.modelsReturn,
}));

// Import AFTER mocks are registered.
import { ModelSelector } from "../ModelSelector";

function resetMocks() {
  mockState.modelsReturn.models = [];
  mockState.modelsReturn.fastMode = false;
  mockState.modelsReturn.loading = false;
  mockState.modelsReturn.error = null;
  mockState.modelsReturn.setModel = vi.fn();
  mockState.modelsReturn.setFastMode = vi.fn();
  mockState.modelsReturn.setThinking = vi.fn();
  mockState.connection.model = {
    provider: "ollama-cloud",
    model: "deepseek-v4-flash:0731-cloud",
    thinking: "xhigh",
  };
}

beforeEach(() => {
  resetMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── Helpers ──

/** Set the mock catalog to a single model with the given capability flags. */
function setModelCatalog(opts: {
  id?: string;
  supportsThinking?: boolean;
  supportsFast?: boolean;
  provider?: string;
}) {
  const id = opts.id ?? "deepseek-v4-flash:0731-cloud";
  const provider = opts.provider ?? "ollama-cloud";
  mockState.modelsReturn.models = [
    {
      id,
      name: "DeepSeek V4 Flash",
      provider,
      contextWindow: 1000000,
      maxOutputTokens: 65536,
      supportsThinking: opts.supportsThinking,
      supportsFast: opts.supportsFast,
    },
  ];
  // Point the current selection at the first model.
  mockState.connection.model = { provider, model: id, thinking: "xhigh" };
}

// ── Tests ──

describe("ModelSelector — inline thinking selector", () => {
  it("renders the inline thinking selector at rest when the model supportsThinking", () => {
    setModelCatalog({ supportsThinking: true });
    render(<ModelSelector />);
    // The inline thinking selector is visible WITHOUT opening the dropdown.
    const inline = screen.getByTestId("ms-inline-thinking");
    expect(inline).toBeTruthy();
    // It should contain a <select> with the thinking levels.
    const select = inline.querySelector("select");
    expect(select).toBeTruthy();
    // The current thinking level should be reflected.
    expect(select?.value).toBe("xhigh");
  });

  it("does NOT render the thinking selector when the model does not support thinking", () => {
    setModelCatalog({ supportsThinking: false });
    render(<ModelSelector />);
    expect(screen.queryByTestId("ms-inline-thinking")).toBeNull();
  });
});

describe("ModelSelector — inline fast-mode toggle", () => {
  it("renders the fast-mode toggle inline when the model supportsFast", () => {
    setModelCatalog({ supportsFast: true });
    render(<ModelSelector />);
    const toggle = screen.getByTestId("ms-fast-toggle");
    expect(toggle).toBeTruthy();
    // Should be present at rest — aria-pressed reflects the fastMode state.
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
  });

  it("does NOT render the fast-mode toggle when the model does not support fast", () => {
    setModelCatalog({ supportsFast: false });
    render(<ModelSelector />);
    expect(screen.queryByTestId("ms-fast-toggle")).toBeNull();
  });

  it("toggling fast-mode calls setFastMode with the new value", async () => {
    setModelCatalog({ supportsFast: true });
    render(<ModelSelector />);
    const toggle = screen.getByTestId("ms-fast-toggle");
    // fastMode starts false; clicking toggles to true.
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(mockState.modelsReturn.setFastMode).toHaveBeenCalledWith(true);
    });
    // setModel should also be called to push the new fastMode to the engine.
    // supportsThinking is false in this test, so thinking is undefined.
    expect(mockState.modelsReturn.setModel).toHaveBeenCalledWith(
      "ollama-cloud",
      "deepseek-v4-flash:0731-cloud",
      undefined,
      undefined,
      true,
    );
  });
});

describe("ModelSelector — old in-panel thinking block is gone", () => {
  it("does not render the old ms-thinking block inside the panel when open", () => {
    setModelCatalog({ supportsThinking: true });
    render(<ModelSelector />);
    // Open the dropdown by clicking the trigger.
    const trigger = screen.getByRole("button");
    // The trigger is the first button with the ms-trigger class.
    fireEvent.click(trigger);
    // The panel should be open now.
    expect(screen.getByRole("listbox")).toBeTruthy();
    // The old ms-thinking in-panel block should be absent from the panel.
    const panel = screen.getByRole("listbox");
    expect(panel.querySelector(".ms-thinking")).toBeNull();
  });

  it("keeps the inline thinking selector visible while the panel is open", () => {
    // Regression-proofing: the inline controls live OUTSIDE the {open ? panel}
    // block, so opening the dropdown must NOT unmount the inline thinking
    // selector. This guards against a future refactor that tucks the inline
    // row back inside the panel conditional.
    setModelCatalog({ supportsThinking: true });
    render(<ModelSelector />);
    // Sanity: present at rest.
    expect(screen.getByTestId("ms-inline-thinking")).toBeTruthy();
    // Open the dropdown.
    const trigger = screen.getByRole("button", { name: /ollama-cloud|deepseek|model/i });
    fireEvent.click(trigger);
    expect(screen.getByRole("listbox")).toBeTruthy();
    // The inline thinking selector must STILL be in the document, AND it must
    // be OUTSIDE the panel element (the inline row is a sibling of the panel,
    // both inside ms-root).
    const inline = screen.getByTestId("ms-inline-thinking");
    expect(inline).toBeTruthy();
    const panel = screen.getByRole("listbox");
    expect(panel.contains(inline)).toBe(false);
  });
});

describe("ModelSelector — supportsFast × supportsThinking intersection", () => {
  it("preserves the current thinking level when toggling fast-mode on a model that supports both", async () => {
    // A model with BOTH capabilities: the fast toggle must push fastMode to
    // the engine WITHOUT dropping the currently-selected thinking level.
    // We exercise the supportsThinking ? thinking : undefined branch of
    // handleFastToggle for the TRUE case (the existing fast-toggle test only
    // covers the supportsThinking:false branch where thinking is undefined).
    setModelCatalog({ supportsThinking: true, supportsFast: true });
    // Pin a distinct current thinking level so the assertion is specific.
    mockState.modelsReturn.thinking = "high" as ThinkingLevel;
    render(<ModelSelector />);
    // Sanity: both inline controls render together.
    expect(screen.getByTestId("ms-inline-thinking")).toBeTruthy();
    expect(screen.getByTestId("ms-fast-toggle")).toBeTruthy();
    // The inline thinking select reflects the pinned level.
    expect(screen.getByTestId("ms-inline-thinking").querySelector("select")?.value).toBe("high");

    // Toggle fast-mode on.
    fireEvent.click(screen.getByTestId("ms-fast-toggle"));
    await waitFor(() => {
      expect(mockState.modelsReturn.setFastMode).toHaveBeenCalledWith(true);
    });
    // setModel must be called with the PRESERVED thinking level ("high"),
    // NOT undefined — proving the thinking×fast interaction is correct.
    expect(mockState.modelsReturn.setModel).toHaveBeenCalledWith(
      "ollama-cloud",
      "deepseek-v4-flash:0731-cloud",
      "high",
      undefined,
      true,
    );
  });
});
