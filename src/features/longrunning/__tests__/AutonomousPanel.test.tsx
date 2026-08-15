// AutonomousPanel — bounded autonomous mode control. Mocks ipc/client so the
// Start/Stop/Nudge actions drive prompt()/steer() against a controllable
// client, and the daemon connection snapshot drives the live Active state.

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AutonomousPanel, type QualityGate } from "../AutonomousPanel";

const mockClient = vi.hoisted(() => ({
  prompt: vi.fn(),
  steer: vi.fn(),
}));

const mockConn = vi.hoisted(() => ({
  status: { kind: "connected" },
  context: { tokens: 100 },
  queue: { mode: "idle" },
  autonomousConfig: undefined as any,
}));

vi.mock("../../../ipc/client", () => ({
  useIpc: () => mockClient,
  useConnectionState: () => mockConn,
}));

const gates: QualityGate[] = [
  { id: "g1", command: "npm run build", description: "Build passes" },
  { id: "g2", command: "npm test" },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockConn.status = { kind: "connected" };
  mockConn.context = { tokens: 100 };
  mockConn.queue = { mode: "idle" };
  mockConn.autonomousConfig = undefined;
  (mockClient.prompt as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (mockClient.steer as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
});

describe("AutonomousPanel", () => {
  it("renders the Not running state with a Start action by default", () => {
    render(<AutonomousPanel />);
    expect(screen.getByText("Not running")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start autonomous/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /stop autonomous/i })).not.toBeInTheDocument();
  });

  it("shows Active and Stop/Nudge when seeded active via the prop", () => {
    render(<AutonomousPanel defaultActive />);
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /stop autonomous/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /nudge/i })).toBeInTheDocument();
  });

  it("starts the mode via ipc.prompt('/autonomous on') and flips to Active", async () => {
    const user = userEvent.setup();
    render(<AutonomousPanel />);
    await user.click(screen.getByRole("button", { name: /start autonomous/i }));
    await waitFor(() => expect(mockClient.prompt).toHaveBeenCalledWith("/autonomous on"));
    await waitFor(() => expect(screen.getByText("Active")).toBeInTheDocument());
  });

  it("stops the mode via ipc.prompt('/autonomous off')", async () => {
    const user = userEvent.setup();
    render(<AutonomousPanel defaultActive />);
    await user.click(screen.getByRole("button", { name: /stop autonomous/i }));
    await waitFor(() => expect(mockClient.prompt).toHaveBeenCalledWith("/autonomous off"));
    await waitFor(() => expect(screen.getByText("Not running")).toBeInTheDocument());
  });

  it("nudges the loop via ipc.steer", async () => {
    const user = userEvent.setup();
    render(<AutonomousPanel defaultActive />);
    await user.click(screen.getByRole("button", { name: /nudge/i }));
    await waitFor(() => expect(mockClient.steer).toHaveBeenCalledWith("Continue the autonomous run and report progress"));
  });

  it("surfaces an error when starting fails", async () => {
    const user = userEvent.setup();
    (mockClient.prompt as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("no active daemon connection"));
    render(<AutonomousPanel />);
    await user.click(screen.getByRole("button", { name: /start autonomous/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByText(/no active daemon connection/i)).toBeInTheDocument();
  });

  it("renders quality gates and their count", () => {
    render(<AutonomousPanel gates={gates} />);
    expect(screen.getByText("npm run build")).toBeInTheDocument();
    expect(screen.getByText("Build passes")).toBeInTheDocument();
    expect(screen.getByText("npm test")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("shows an empty-state note when no gates are configured", () => {
    render(<AutonomousPanel />);
    expect(screen.getByText(/no quality gates configured/i)).toBeInTheDocument();
  });

  it("surfaces the daemon's active budget read-only", () => {
    mockConn.autonomousConfig = { active: true, maxTurns: 12, maxTokens: 80000, maxTime: "30m" };
    render(<AutonomousPanel />);
    expect(screen.getByText(/active budget: 12 turns · 80k tokens · 30m/i)).toBeInTheDocument();
  });
});
