// SystemBar.test.tsx — the Monitor archetype: engine status, model, and
// context visible at rest; session telemetry one click away behind Details.

import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SystemBar } from "../SystemBar";

const mockState = vi.hoisted(() => {
  const listeners: Array<(event: unknown) => void> = [];
  return {
    conn: {} as any,
    client: { listAgents: vi.fn(), onEvent: vi.fn(), listSessions: vi.fn() },
    fireEvent: (e: unknown) => {
      for (const cb of [...listeners]) cb(e);
    },
    listeners,
  };
});

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

function setConn(overrides: Record<string, unknown> = {}) {
  mockState.conn = {
    status: { kind: "connected" },
    model: { provider: "ollama-cloud", model: "deepseek-v4-flash:0731-cloud" },
    context: { tokens: 18432, contextWindow: 1000000, messages: 42 },
    activeSessionId: "session-0",
    costStats: { sessionCost: 0.31, totalCost: 0.84 },
    autonomousConfig: { active: false, maxTurns: 12 },
    ...overrides,
  };
}

beforeEach(() => {
  setConn();
  (mockState.client.listAgents as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (mockState.client.listSessions as ReturnType<typeof vi.fn>).mockResolvedValue([
    { id: "session-0", cwd: "C:\\work\\api-service" },
  ]);
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

describe("SystemBar", () => {
  it("renders the brand and platform", () => {
    render(<SystemBar engineOpen={false} onToggleEngine={() => {}} />);
    expect(screen.getByText("SOPHOS")).toBeInTheDocument();
    expect(screen.getByText("Windows")).toBeInTheDocument();
  });

  it("shows the engine status label and model readout", () => {
    render(<SystemBar engineOpen={false} onToggleEngine={() => {}} />);
    expect(screen.getByText("Engine live")).toBeInTheDocument();
    expect(screen.getByText("deepseek-v4-flash:0731-cloud")).toBeInTheDocument();
  });

  it.each([
    [{ kind: "connected" }, "Engine live"],
    [{ kind: "connecting" }, "Connecting"],
    [{ kind: "reconnecting" }, "Reconnecting"],
    [{ kind: "disconnected" }, "Engine offline"],
  ] as const)("reflects the %s status label", (status, label) => {
    setConn({ status });
    render(<SystemBar engineOpen={false} onToggleEngine={() => {}} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("computes the context percentage readout", () => {
    setConn({ context: { tokens: 25000, contextWindow: 100000 } });
    render(<SystemBar engineOpen={false} onToggleEngine={() => {}} />);
    expect(screen.getByText("25%")).toBeInTheDocument();
  });

  it("shows the AUTO alert when autonomous mode is active", () => {
    setConn({ autonomousConfig: { active: true, maxTurns: 12 } });
    render(<SystemBar engineOpen={false} onToggleEngine={() => {}} />);
    expect(screen.getByText("AUTO")).toBeInTheDocument();
  });

  it("does not show AUTO when autonomous mode is off", () => {
    render(<SystemBar engineOpen={false} onToggleEngine={() => {}} />);
    expect(screen.queryByText("AUTO")).not.toBeInTheDocument();
  });

  it("shows the REFINE alert when a refinement is pending review", () => {
    gateMock.useRefinementGate.mockReturnValue({
      pending: { result: { id: "r1" }, receivedAt: "now", diff: [] },
      history: [],
      autoApply: false,
      apply: vi.fn(),
      discard: vi.fn(),
      setAutoApply: vi.fn(),
    });
    render(<SystemBar engineOpen={false} onToggleEngine={() => {}} />);
    expect(screen.getByText("REFINE")).toBeInTheDocument();
  });

  it("opens the details dialog with session telemetry", async () => {
    (mockState.client.listAgents as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "a1", status: "running" },
      { id: "a2", status: "idle" },
    ]);
    render(<SystemBar engineOpen={false} onToggleEngine={() => {}} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Session details" }));
    const dialog = screen.getByRole("dialog", { name: "Session details" });
    expect(dialog).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("1 live")).toBeInTheDocument());
    expect(screen.getByText("C:\\work\\api-service")).toBeInTheDocument();
    expect(screen.getByText("$0.31")).toBeInTheDocument();
    expect(screen.getByText("$0.84")).toBeInTheDocument();
  });

  it("closes the details dialog with Escape", () => {
    render(<SystemBar engineOpen={false} onToggleEngine={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Session details" }));
    expect(screen.getByRole("dialog", { name: "Session details" })).toBeInTheDocument();

    // SystemBar listens on document for Escape.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("calls onToggleEngine when the terminal icon is clicked", () => {
    const onToggleEngine = vi.fn();
    render(<SystemBar engineOpen={false} onToggleEngine={onToggleEngine} />);
    fireEvent.click(screen.getByRole("button", { name: "Show engine terminal" }));
    expect(onToggleEngine).toHaveBeenCalledTimes(1);
  });
});
