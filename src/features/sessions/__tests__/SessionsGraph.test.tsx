// SessionsGraph.test.tsx — sessions rendered as a node graph. Mocks the shared
// graph primitives (../../graph) and the small @xyflow/react surface the
// component pulls directly, so the node/edge *construction* and click routing
// can be asserted without the full React Flow renderer: session / goal / RLM
// nodes, active-status override, goal-status mapping, the context ring on
// session nodes, edges, and session-only click handling.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SessionInfo, ContextStats, Goal, RlmChild } from "../../../ipc/contract";
import { SessionsGraph } from "../SessionsGraph";

type TestEnrichment = Record<
  string,
  { context?: ContextStats; goals?: Goal[]; rlmChildren?: RlmChild[] }
>;

vi.mock("@xyflow/react", async () => {
  const { useState } = await import("react");
  return {
    useNodesState: (initial: unknown[]) => {
      const [nodes, setNodes] = useState(initial);
      return [nodes, setNodes, () => {}];
    },
    Handle: () => null,
    Position: { Left: "left", Right: "right" },
  };
});

vi.mock("../../graph", async () => ({
  GraphFlow: ({ nodes, edges, onNodeClick, children }: any) => (
    <div data-testid="graph-flow" data-nodes={nodes.length} data-edges={edges.length}>
      {nodes.map((n: any) => (
        <button
          key={n.id}
          data-testid={`node-${n.id}`}
          data-kind={n.data?.kind}
          data-status={n.data?.status}
          data-label={n.data?.label}
          data-ring={Boolean(n.data?.ring)}
          onClick={() => onNodeClick?.(n.id)}
        >
          {n.data?.label}
        </button>
      ))}
      {children}
    </div>
  ),
  NodeFrame: () => null,
  PulseEdge: () => null,
  dagreLayout: (nodes: any[]) => new Map(nodes.map((n) => [n.id, { x: 0, y: 0 }])),
}));

const session: SessionInfo = {
  id: "s-1",
  title: "Alpha project",
  status: "saved",
  cwd: "C:\\work",
};

const enrichment = {
  "s-1": {
    context: { tokens: 2000, contextWindow: 10000, messages: 3 },
    goals: [{ id: "g1", objective: "Ship release", status: "active" as const }],
    rlmChildren: [{ id: "r1", name: "reviewer", status: "running" as const }],
  },
};

function renderGraph({
  sessions = [session],
  enrichmentMap = enrichment,
  activeSessionId,
}: {
  sessions?: SessionInfo[];
  enrichmentMap?: TestEnrichment;
  activeSessionId?: string;
} = {}) {
  const handlers = { onSelect: vi.fn(), onResume: vi.fn(), onFork: vi.fn() };
  const utils = render(
    <SessionsGraph
      sessions={sessions}
      enrichment={enrichmentMap}
      activeSessionId={activeSessionId}
      daemonDown={false}
      onSelect={handlers.onSelect}
      onResume={handlers.onResume}
      onFork={handlers.onFork}
    />,
  );
  return { handlers, ...utils };
}

describe("SessionsGraph", () => {
  it("renders nothing when there are no sessions", () => {
    const { container } = renderGraph({ sessions: [], enrichmentMap: {} });
    expect(container.querySelector('[data-testid="graph-flow"]')).toBeNull();
  });

  it("builds a session node carrying the ring, plus goal and RLM-child nodes", () => {
    renderGraph();
    expect(screen.getByTestId("node-s-1")).toBeInTheDocument();
    expect(screen.getByTestId("node-goal-s-1-g1")).toBeInTheDocument();
    expect(screen.getByTestId("node-rlm-s-1-r1")).toBeInTheDocument();
    // The session node carries a context ring; goal/rlm nodes do not.
    expect(screen.getByTestId("node-s-1").dataset.ring).toBe("true");
    expect(screen.getByTestId("node-goal-s-1-g1").dataset.ring).toBe("false");
  });

  it("creates one edge per goal and RLM child", () => {
    renderGraph();
    // session -> goal and session -> rlm = 2 edges.
    expect(screen.getByTestId("graph-flow")).toHaveAttribute("data-edges", "2");
  });

  it("overrides the node status to active for the active session", () => {
    renderGraph({ activeSessionId: "s-1" });
    expect(screen.getByTestId("node-s-1").dataset.status).toBe("active");
  });

  it("keeps the session's own status when it is not the active one", () => {
    renderGraph();
    expect(screen.getByTestId("node-s-1").dataset.status).toBe("saved");
  });

  it("maps goal statuses onto node statuses", () => {
    renderGraph({
      enrichmentMap: {
        "s-1": {
          goals: [
            { id: "g-active", objective: "a", status: "active" },
            { id: "g-completed", objective: "c", status: "completed" },
            { id: "g-paused", objective: "p", status: "paused" },
            { id: "g-cleared", objective: "x", status: "cleared" },
          ],
        },
      },
    });
    expect(screen.getByTestId("node-goal-s-1-g-active").dataset.status).toBe("running");
    expect(screen.getByTestId("node-goal-s-1-g-completed").dataset.status).toBe("done");
    expect(screen.getByTestId("node-goal-s-1-g-paused").dataset.status).toBe("paused");
    expect(screen.getByTestId("node-goal-s-1-g-cleared").dataset.status).toBe("idle");
  });

  it("calls onSelect only when a session node is clicked", async () => {
    const { handlers } = renderGraph();

    await userEvent.click(screen.getByText("Alpha project"));
    expect(handlers.onSelect).toHaveBeenCalledWith("s-1");
    expect(handlers.onSelect).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByText("Ship release"));
    await userEvent.click(screen.getByText("reviewer"));
    // Goal / RLM clicks must not select a session.
    expect(handlers.onSelect).toHaveBeenCalledTimes(1);
  });

  it("renders the reset-layout control", () => {
    renderGraph();
    expect(screen.getByRole("button", { name: /reset layout/i })).toBeInTheDocument();
  });
});
