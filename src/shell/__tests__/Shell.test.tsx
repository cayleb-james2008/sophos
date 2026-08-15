// Shell.test.tsx — the app frame. Hosts the global shortcut overlay (`?` and
// Cmd/Ctrl+/), an on-demand engine terminal, and routes children between the
// sidebar and main content. Heavy feature modules are mocked so we can focus
// on the shell's own wiring.

import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  conn: { status: { kind: "connected" }, model: { provider: "p", model: "m" }, context: { tokens: 0, contextWindow: 1000 } },
  client: { listAgents: vi.fn(), onEvent: vi.fn(), listSessions: vi.fn() },
}));

vi.mock("../../ipc/client", () => ({
  useConnectionState: () => mockState.conn,
  useIpc: () => mockState.client,
  useIpcEvent: () => undefined,
}));

const gateMock = vi.hoisted(() => ({ useRefinementGate: vi.fn() }));
vi.mock("../../features/longrunning/useRefinementGate", () => ({
  useRefinementGate: gateMock.useRefinementGate,
  RefinementGateProvider: () => null,
}));

vi.mock("../../features/longrunning/RefinementGateBanner", () => ({ RefinementGateBanner: () => null }));
vi.mock("../../features/longrunning/RunGuardBanner", () => ({ RunGuardBanner: () => null }));
vi.mock("../../features/settings/DaemonStatusBanner", () => ({ DaemonStatusBanner: () => null }));
vi.mock("../../features/engine/EnginePanel", () => ({
  EnginePanel: ({ open }: { open: boolean }) => <div data-testid="engine-panel" data-open={String(open)}>engine</div>,
}));

import { Shell } from "../Shell";

function press(key: string, init: KeyboardEventInit = {}) {
  fireEvent.keyDown(window, { key, ...init });
}

beforeEach(() => {
  (mockState.client.listAgents as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (mockState.client.listSessions as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (mockState.client.onEvent as ReturnType<typeof vi.fn>).mockReturnValue(() => {});
  gateMock.useRefinementGate.mockReturnValue({
    pending: null,
    history: [],
    autoApply: false,
    apply: vi.fn(),
    discard: vi.fn(),
    setAutoApply: vi.fn(),
  });
});

describe("Shell", () => {
  it("renders its children in the main content area", () => {
    render(
      <Shell active="chat" onNavigate={() => {}}>
        <p>main content</p>
      </Shell>,
    );
    expect(screen.getByText("main content")).toBeInTheDocument();
    // Sidebar nav is present alongside.
    expect(screen.getByRole("button", { name: "Chat" })).toBeInTheDocument();
  });

  it("opens the shortcuts overlay when ? is pressed", () => {
    render(
      <Shell active="chat" onNavigate={() => {}}>
        <div />
      </Shell>,
    );
    expect(screen.queryAllByText("Show keyboard shortcuts")).toHaveLength(0);
    press("?");
    // Both ? and Cmd+/ register the same description, so two rows render.
    expect(screen.getAllByText("Show keyboard shortcuts").length).toBeGreaterThan(0);
  });

  it("opens the shortcuts overlay with Cmd+/ (ctrl on Windows)", () => {
    render(
      <Shell active="chat" onNavigate={() => {}}>
        <div />
      </Shell>,
    );
    press("/", { ctrlKey: true });
    expect(screen.getAllByText("Show keyboard shortcuts").length).toBeGreaterThan(0);
  });

  it("toggles the shortcuts overlay off", () => {
    render(
      <Shell active="chat" onNavigate={() => {}}>
        <div />
      </Shell>,
    );
    press("?");
    expect(screen.getAllByText("Show keyboard shortcuts").length).toBeGreaterThan(0);
    press("?");
    expect(screen.queryAllByText("Show keyboard shortcuts")).toHaveLength(0);
  });

  it("opens and closes the engine terminal via the SystemBar toggle", () => {
    render(
      <Shell active="chat" onNavigate={() => {}}>
        <div />
      </Shell>,
    );
    const panel = screen.getByTestId("engine-panel");
    expect(panel).toHaveAttribute("data-open", "false");

    fireEvent.click(screen.getByRole("button", { name: "Show engine terminal" }));
    expect(screen.getByTestId("engine-panel")).toHaveAttribute("data-open", "true");

    fireEvent.click(screen.getByRole("button", { name: "Hide engine terminal" }));
    expect(screen.getByTestId("engine-panel")).toHaveAttribute("data-open", "false");
  });

  it("navigates when a sidebar item is clicked", () => {
    const onNavigate = vi.fn();
    render(
      <Shell active="chat" onNavigate={onNavigate}>
        <div />
      </Shell>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Agents" }));
    expect(onNavigate).toHaveBeenCalledWith("agents");
  });
});
