// RlmChildrenPanel.test.tsx — RlmChildrenPanel renders the RLM-children
// (subagents) card: empty state, per-status badges, summaries, and Refresh.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RlmChildrenPanel } from "../RlmChildrenPanel";
import type { RlmChild } from "../../../ipc/contract";

const CHILDREN: RlmChild[] = [
  { id: "c-1", name: "Resolver", status: "running", summary: "Looking up symbols" },
  { id: "c-2", name: "Writer", status: "idle" },
  { id: "c-3", name: "Cleanup", status: "done", summary: "Pruned stale branches" },
  { id: "c-4", name: "Crashed", status: "error", summary: "OOM during build" },
];

describe("RlmChildrenPanel", () => {
  it("shows an empty state when there are no subagents", () => {
    render(<RlmChildrenPanel children={[]} onRefresh={vi.fn()} />);
    expect(screen.getByText(/No subagents running/i)).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("renders each child with name, summary, and status badge", () => {
    render(<RlmChildrenPanel children={CHILDREN} onRefresh={vi.fn()} />);
    expect(screen.getByText("Resolver")).toBeInTheDocument();
    expect(screen.getByText("Looking up symbols")).toBeInTheDocument();
    expect(screen.getByText("Writer")).toBeInTheDocument();
    expect(screen.getByText("Cleanup")).toBeInTheDocument();
    expect(screen.getByText("Crashed")).toBeInTheDocument();
    for (const label of ["Running", "Idle", "Done", "Error"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("does not render a summary row for children without one", () => {
    render(<RlmChildrenPanel children={[CHILDREN[1]]} onRefresh={vi.fn()} />);
    expect(screen.getByText("Writer")).toBeInTheDocument();
    expect(screen.queryByText(/Pruned stale branches/i)).not.toBeInTheDocument();
  });

  it("calls onRefresh when Refresh is clicked", async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    render(<RlmChildrenPanel children={CHILDREN} onRefresh={onRefresh} />);

    await user.click(screen.getByRole("button", { name: /refresh/i }));

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
