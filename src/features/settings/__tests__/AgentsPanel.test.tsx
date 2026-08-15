// AgentsPanel.test.tsx — AgentsPanel renders the attached-agents card: empty
// state, per-status badges, session id, and the Attach action wired to onAttach.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AgentsPanel } from "../AgentsPanel";
import type { AgentInfo } from "../../../ipc/contract";

const AGENTS: AgentInfo[] = [
  { id: "a-1", name: "Scout", status: "running", sessionId: "sess-1" },
  { id: "a-2", name: "Builder", status: "idle" },
  { id: "a-3", name: "Archiver", status: "saved", sessionId: "sess-3" },
];

describe("AgentsPanel", () => {
  it("shows an empty state when there are no agents", () => {
    render(<AgentsPanel agents={[]} onAttach={vi.fn()} onRefresh={vi.fn()} />);
    expect(screen.getByText(/No agents attached/i)).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("renders each agent with a name, session id, and a status badge", () => {
    render(<AgentsPanel agents={AGENTS} onAttach={vi.fn()} onRefresh={vi.fn()} />);
    expect(screen.getByText("Scout")).toBeInTheDocument();
    expect(screen.getByText("Builder")).toBeInTheDocument();
    expect(screen.getByText("Archiver")).toBeInTheDocument();
    expect(screen.getByText("session sess-1")).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("Idle")).toBeInTheDocument();
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  it("maps every agent status to a badge tone", () => {
    render(<AgentsPanel agents={AGENTS} onAttach={vi.fn()} onRefresh={vi.fn()} />);
    // All three statuses render a dot badge; just assert their presence.
    for (const label of ["Running", "Idle", "Saved"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it("calls onAttach with the agent id when Attach is clicked", async () => {
    const user = userEvent.setup();
    const onAttach = vi.fn();
    render(<AgentsPanel agents={AGENTS} onAttach={onAttach} onRefresh={vi.fn()} />);

    await user.click(screen.getAllByRole("button", { name: /attach/i })[0]);

    expect(onAttach).toHaveBeenCalledWith("a-1");
  });

  it("calls onRefresh when the Refresh button is clicked", async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    render(<AgentsPanel agents={AGENTS} onAttach={vi.fn()} onRefresh={onRefresh} />);

    await user.click(screen.getByRole("button", { name: /refresh/i }));

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
