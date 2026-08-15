// GoalsPanel.test.tsx — the persistent-goals panel. Mocks the IPC client and
// connection state so creation / pause / resume / clear (routed through
// ipc.prompt("/goal ...")) and the optimistic local updates can be asserted.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GoalsPanel } from "../GoalsPanel";
import type { Goal } from "../../../ipc/contract";

const mockIpc = vi.hoisted(() => ({
  prompt: vi.fn(),
  steer: vi.fn(),
}));

const mockGoals = vi.hoisted(() => [] as Goal[]);

vi.mock("../../../ipc/client", async () => ({
  useIpc: () => mockIpc,
  useConnectionState: () => ({ goals: mockGoals, status: { kind: "connected" } }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockGoals.length = 0;
  (mockIpc.prompt as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (mockIpc.steer as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
});

function addGoal(overrides: Partial<Goal> = {}): Goal {
  const g: Goal = { id: "g-1", objective: "Ship the release", status: "active", ...overrides };
  mockGoals.push(g);
  return g;
}

describe("GoalsPanel", () => {
  it("renders the title and a no-active-goals state when empty", () => {
    render(<GoalsPanel />);
    expect(screen.getAllByText("Goals").length).toBeGreaterThan(0);
    expect(screen.getByText("no active goals")).toBeInTheDocument();
    expect(screen.getByText("No active goals")).toBeInTheDocument();
  });

  it("renders goals from the connection state with their status badge", () => {
    addGoal();
    render(<GoalsPanel />);
    expect(screen.getByText("Ship the release")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText(/1 active goal/)).toBeInTheDocument();
  });

  it("reports the active count with pluralization for multiple goals", () => {
    addGoal();
    addGoal({ id: "g-2", objective: "Verify artifacts" });
    render(<GoalsPanel />);
    expect(screen.getByText(/2 active goals/)).toBeInTheDocument();
  });

  it("creates a goal via the prompt pipeline and updates optimistically", async () => {
    const user = userEvent.setup();
    render(<GoalsPanel />);

    const input = screen.getByLabelText("Set goal");
    await user.type(input, "Ship v0.5");
    await user.click(screen.getByRole("button", { name: /^set$/i }));

    expect(mockIpc.prompt).toHaveBeenCalledWith("/goal Ship v0.5");
    // Optimistic row appears immediately.
    expect(screen.getByText("Ship v0.5")).toBeInTheDocument();
    // Input is cleared after submission.
    expect(input).toHaveValue("");
  });

  it("does not submit an empty goal", async () => {
    const user = userEvent.setup();
    render(<GoalsPanel />);
    expect(screen.getByRole("button", { name: /^set$/i })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /^set$/i }));
    expect(mockIpc.prompt).not.toHaveBeenCalled();
  });

  it("pauses an active goal and offers Resume", async () => {
    const user = userEvent.setup();
    addGoal();
    render(<GoalsPanel />);

    await user.click(screen.getByRole("button", { name: /pause/i }));
    expect(mockIpc.prompt).toHaveBeenCalledWith("/goal pause");
    // Local status flips to paused → Resume appears.
    expect(screen.getByRole("button", { name: /resume/i })).toBeInTheDocument();
  });

  it("resumes a paused goal", async () => {
    const user = userEvent.setup();
    addGoal({ status: "paused" });
    render(<GoalsPanel />);

    await user.click(screen.getByRole("button", { name: /resume/i }));
    expect(mockIpc.prompt).toHaveBeenCalledWith("/goal resume");
    // Flips back to active → Pause appears again.
    expect(screen.getByRole("button", { name: /pause/i })).toBeInTheDocument();
  });

  it("clears a goal and hides its Clear action", async () => {
    const user = userEvent.setup();
    addGoal();
    render(<GoalsPanel />);

    await user.click(screen.getByRole("button", { name: /clear/i }));
    expect(mockIpc.prompt).toHaveBeenCalledWith("/goal clear");
    // Cleared goals no longer show a Clear action.
    expect(screen.getByText("Cleared")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /clear/i })).not.toBeInTheDocument();
  });

  it("collapses and expands the body via the chevron", async () => {
    const user = userEvent.setup();
    addGoal();
    const { container } = render(<GoalsPanel />);
    expect(container.querySelector(".goals-body")).not.toBeNull();

    await user.click(screen.getByTitle("Collapse"));
    expect(container.querySelector(".goals-body")).toBeNull();

    await user.click(screen.getByTitle("Expand"));
    expect(container.querySelector(".goals-body")).not.toBeNull();
  });

  it("surfaces an action error banner when the daemon rejects", async () => {
    const user = userEvent.setup();
    (mockIpc.prompt as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("no daemon"));
    render(<GoalsPanel />);

    const input = screen.getByLabelText("Set goal");
    await user.type(input, "Ship it");
    await user.click(screen.getByRole("button", { name: /^set$/i }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/no daemon/i)).toBeInTheDocument();
  });

  it("honors a custom title and can be non-collapsible", () => {
    const { container } = render(<GoalsPanel title="Milestones" collapsible={false} />);
    expect(screen.getByText("Milestones")).toBeInTheDocument();
    // No chevron control when non-collapsible.
    expect(screen.queryByTitle("Collapse")).not.toBeInTheDocument();
    expect(container.querySelector(".goals-body")).not.toBeNull();
  });
});
