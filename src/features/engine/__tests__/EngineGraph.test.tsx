// EngineGraph.test.tsx — the live engine process topology. Mocks the shared
// graph primitives and @xyflow/react so node/edge construction and status
// mapping can be asserted without the full renderer.

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EngineGraph } from "../EngineGraph";
import type { RlmChild } from "../../../ipc/contract";

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
  GraphFlow: ({ nodes, edges, children }: any) => (
    <div data-testid="graph-flow" data-nodes={nodes.length} data-edges={edges.length}>
      {nodes.map((n: any) => (
        <div key={n.id} data-testid={`node-${n.id}`} data-kind={n.data?.kind} data-status={n.data?.status} data-label={n.data?.label} data-mono={n.data?.mono}>
          {n.data?.label}
        </div>
      ))}
      {children}
    </div>
  ),
  NodeFrame: () => null,
  PulseEdge: () => null,
  dagreLayout: (nodes: any[]) => new Map(nodes.map((n) => [n.id, { x: 0, y: 0 }])),
}));

const worker: RlmChild = { id: "w-1", name: "api-reviewer", status: "running", parentId: "daemon", summary: "reviewing" };

describe("EngineGraph", () => {
  it("builds sidecar, daemon, and worker nodes", () => {
    render(<EngineGraph daemonAlive workers={[worker]} />);
    expect(screen.getByTestId("node-sidecar")).toBeInTheDocument();
    expect(screen.getByTestId("node-daemon")).toBeInTheDocument();
    expect(screen.getByTestId("node-worker-w-1")).toBeInTheDocument();
    expect(screen.getByTestId("node-worker-w-1").dataset.kind).toBe("worker");
  });

  it("maps alive daemon/sidecar to connected and down to disconnected", () => {
    const { rerender } = render(<EngineGraph daemonAlive sidecarAlive workers={[]} />);
    expect(screen.getByTestId("node-daemon").dataset.status).toBe("connected");
    expect(screen.getByTestId("node-sidecar").dataset.status).toBe("connected");

    rerender(<EngineGraph daemonAlive={false} sidecarAlive={false} workers={[]} />);
    expect(screen.getByTestId("node-daemon").dataset.status).toBe("disconnected");
    expect(screen.getByTestId("node-sidecar").dataset.status).toBe("disconnected");
  });

  it("shows connecting while alive state is unknown (undefined)", () => {
    render(<EngineGraph daemonAlive={undefined} sidecarAlive={undefined} workers={[]} />);
    expect(screen.getByTestId("node-daemon").dataset.status).toBe("connecting");
    expect(screen.getByTestId("node-sidecar").dataset.status).toBe("connecting");
  });

  it("forces idle status in preview mode", () => {
    render(<EngineGraph daemonAlive sidecarAlive workers={[worker]} preview />);
    expect(screen.getByTestId("node-daemon").dataset.status).toBe("idle");
    expect(screen.getByTestId("node-worker-w-1").dataset.status).toBe("running");
  });

  it("creates one bridge->daemon edge plus one per worker", () => {
    render(<EngineGraph daemonAlive sidecarAlive workers={[worker]} />);
    // bridge-daemon + daemon->w-1 = 2 edges.
    expect(screen.getByTestId("graph-flow")).toHaveAttribute("data-edges", "2");
  });

  it("renders the legend and the preview marker", () => {
    render(<EngineGraph daemonAlive workers={[]} preview />);
    expect(screen.getByText("IPC link")).toBeInTheDocument();
    expect(screen.getByText("worker running")).toBeInTheDocument();
    expect(screen.getByText("offline")).toBeInTheDocument();
    expect(screen.getByText("browser preview")).toBeInTheDocument();
  });

  it("renders a worker's summary as its subtitle", () => {
    render(<EngineGraph workers={[worker]} />);
    expect(screen.getByTestId("node-worker-w-1").textContent).toContain("api-reviewer");
  });
});
