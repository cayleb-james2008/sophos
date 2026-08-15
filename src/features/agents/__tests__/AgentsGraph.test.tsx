// AgentsGraph.test.tsx — the fleet rendered as a node graph. Mocks the shared
// graph primitives and the small @xyflow/react surface so node/edge
// *construction* and click routing can be asserted without the full renderer.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ConnectionStatus } from "../../../ipc/contract";
import { AgentsGraph } from "../AgentsGraph";
import type { AgentRow } from "../useAgents";

vi.mock("@xyflow/react", async () => {
  const { useState } = await import("react");
  return {
    useNodesState: (initial: unknown[]) => {
      const [nodes, setNodes] = useState(initial);
      return [nodes, setNodes, () => {}];
    },
    Handle: () => null,
    Position: { Top: "top", Bottom: "bottom" },
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
          data-subtitle={n.data?.subtitle}
          data-mono={n.data?.mono}
          data-attached={Boolean(n.data?.attached)}
          data-unread={n.data?.unread}
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
  statusColor: () => "#00ff00",
  dagreLayout: (nodes: any[]) => new Map(nodes.map((n) => [n.id, { x: 0, y: 0 }])),
}));

const daemon: AgentRow = { id: "a-1", name: "Reviewer", kind: "daemon", status: "running", summary: "checking PRs", model: "deepseek" };
const rlm: AgentRow = { id: "r-1", name: "critic", kind: "rlm", status: "done", parentId: "a-1", summary: "reviewed" };

const connected: ConnectionStatus = { kind: "connected" };

function renderGraph({
  rows = [daemon, rlm],
  connectionStatus = connected,
  attachedIds,
  unreadByAgent,
}: {
  rows?: AgentRow[];
  connectionStatus?: ConnectionStatus;
  attachedIds?: readonly string[];
  unreadByAgent?: (id: string) => number;
} = {}) {
  const handlers = { onSelect: vi.fn(), onAttach: vi.fn(), onDetach: vi.fn(), onMessage: vi.fn() };
  const utils = render(
    <AgentsGraph
      rows={rows}
      connectionStatus={connectionStatus}
      attachedIds={attachedIds ?? []}
      unreadByAgent={unreadByAgent ?? (() => 0)}
      onSelect={handlers.onSelect}
      onAttach={handlers.onAttach}
      onDetach={handlers.onDetach}
      onMessage={handlers.onMessage}
    />,
  );
  return { handlers, ...utils };
}

describe("AgentsGraph", () => {
  it("builds operator, daemon, agent, and rlm nodes", () => {
    renderGraph();
    expect(screen.getByTestId("node-operator")).toBeInTheDocument();
    expect(screen.getByTestId("node-daemon")).toBeInTheDocument();
    expect(screen.getByTestId("node-a-1")).toBeInTheDocument();
    expect(screen.getByTestId("node-r-1")).toBeInTheDocument();
    expect(screen.getByTestId("node-a-1").dataset.kind).toBe("agent");
    expect(screen.getByTestId("node-r-1").dataset.kind).toBe("rlm");
  });

  it("carries the connection status onto the operator + daemon nodes", () => {
    renderGraph();
    expect(screen.getByTestId("node-operator").dataset.status).toBe("connected");
    expect(screen.getByTestId("node-daemon").dataset.status).toBe("connected");
  });

  it("reflects a disconnected relay on the daemon node", () => {
    renderGraph({ connectionStatus: { kind: "disconnected", reason: "pipe down" } });
    expect(screen.getByTestId("node-daemon").dataset.status).toBe("disconnected");
    expect(screen.getByTestId("node-operator").dataset.subtitle).toBe("Relay unreachable");
  });

  it("marks attached agent nodes and carries unread counts", () => {
    renderGraph({ attachedIds: ["a-1"], unreadByAgent: (id) => (id === "a-1" ? 3 : 0) });
    expect(screen.getByTestId("node-a-1").dataset.attached).toBe("true");
    expect(screen.getByTestId("node-a-1").dataset.unread).toBe("3");
    expect(screen.getByTestId("node-r-1").dataset.attached).toBe("false");
  });

  it("creates one edge for the relay link plus one per fleet member", () => {
    renderGraph();
    // operator->daemon + daemon->a-1 + a-1->r-1 (via parent) = 3 edges.
    expect(screen.getByTestId("graph-flow")).toHaveAttribute("data-edges", "3");
  });

  it("calls onSelect only when an agent or rlm node is clicked", async () => {
    const { handlers } = renderGraph();

    await userEvent.click(screen.getByTestId("node-a-1"));
    expect(handlers.onSelect).toHaveBeenCalledWith("a-1");

    await userEvent.click(screen.getByTestId("node-r-1"));
    expect(handlers.onSelect).toHaveBeenCalledWith("r-1");

    // Operator and daemon nodes must not select anything.
    await userEvent.click(screen.getByTestId("node-operator"));
    await userEvent.click(screen.getByTestId("node-daemon"));
    expect(handlers.onSelect).toHaveBeenCalledTimes(2);
  });

  it("renders no fleet members when the rows list is empty (operator + daemon only)", () => {
    renderGraph({ rows: [] });
    expect(screen.getByTestId("node-operator")).toBeInTheDocument();
    expect(screen.getByTestId("node-daemon")).toBeInTheDocument();
    expect(screen.queryByTestId("node-a-1")).not.toBeInTheDocument();
  });
});
