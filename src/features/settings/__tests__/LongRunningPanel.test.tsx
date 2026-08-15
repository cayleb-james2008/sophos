// LongRunningPanel.test.tsx — LongRunningPanel renders an underline tab bar
// over the long-running section panels and swaps the active panel per tab.
// The child panels are stubbed so this test isolates tab orchestration.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LongRunningPanel } from "../LongRunningPanel";

vi.mock("../../../features/longrunning/AutonomousPanel", async () => ({
  AutonomousPanel: () => <div>autonomous-stub</div>,
}));
vi.mock("../../../features/longrunning/HeartbeatsPanel", async () => ({
  HeartbeatsPanel: () => <div>heartbeats-stub</div>,
}));
vi.mock("../../../features/longrunning/SchedulesPanel", async () => ({
  SchedulesPanel: () => <div>schedules-stub</div>,
}));
vi.mock("../../../features/longrunning/RefinementHistory", async () => ({
  RefinementHistory: () => <div>refinement-stub</div>,
}));
vi.mock("../../../features/longrunning/HarnessStatePanel", async () => ({
  HarnessStatePanel: () => <div>harness-stub</div>,
}));
vi.mock("../../../features/goals/GoalsPanel", async () => ({
  GoalsPanel: () => <div>goals-stub</div>,
}));

describe("LongRunningPanel", () => {
  it("defaults to the Autonomous tab", () => {
    render(<LongRunningPanel />);
    expect(screen.getByText("autonomous-stub")).toBeInTheDocument();
  });

  it("switches panels when a tab is clicked", async () => {
    const user = userEvent.setup();
    render(<LongRunningPanel />);

    await user.click(screen.getByRole("tab", { name: /goals/i }));
    expect(screen.getByText("goals-stub")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /heartbeats/i }));
    expect(screen.getByText("heartbeats-stub")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /schedules/i }));
    expect(screen.getByText("schedules-stub")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /refinement/i }));
    expect(screen.getByText("refinement-stub")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /harness state/i }));
    expect(screen.getByText("harness-stub")).toBeInTheDocument();
  });
});
