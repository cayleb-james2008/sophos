// InboxGraph.test.tsx — the agent relay rendered as a message-flow graph.
// Mocks the shared graph primitives (../graph) so the node/edge *construction*
// and click routing can be asserted without dragging in the full React Flow
// renderer: self + peer + message nodes, outgoing/incoming + unread status
// mapping, legend, and message-vs-non-message click handling.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AgentMessage } from "../../../ipc/contract";
import { InboxGraph } from "../InboxGraph";

// The component pulls useNodesState/Handle/Position from @xyflow/react directly
// (not via ../graph). The real package's hooks touch browser-only globals in
// jsdom, so stub the small surface InboxGraph actually uses.
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

const SELF = "self";

function msg(over: Partial<AgentMessage> & Pick<AgentMessage, "id">): AgentMessage {
  return { fromAgentId: SELF, toAgentId: "peer-1", text: "", read: true, ...over };
}

describe("InboxGraph", () => {
  it("renders nothing when there is no peer selected", () => {
    const { container } = render(<InboxGraph thread={[]} onSelectMsg={vi.fn()} />);
    expect(container.querySelector('[data-testid="graph-flow"]')).toBeNull();
  });

  it("builds self, peer, and message nodes", () => {
    render(
      <InboxGraph
        peerId="peer-1"
        peerName="Worker"
        peerStatus="running"
        thread={[msg({ id: "m1", text: "hello", fromAgentId: SELF, toAgentId: "peer-1" })]}
        onSelectMsg={vi.fn()}
      />,
    );

    expect(screen.getByTestId("node-self")).toBeInTheDocument();
    expect(screen.getByTestId("node-peer-1")).toBeInTheDocument();
    expect(screen.getByTestId("node-msg-m1")).toBeInTheDocument();
    expect(screen.getByText("You")).toBeInTheDocument();
    expect(screen.getByText("Worker")).toBeInTheDocument();
    expect(screen.getByText("hello")).toBeInTheDocument();
  });

  it("maps status by direction and read state", () => {
    render(
      <InboxGraph
        peerId="peer-1"
        peerName="Worker"
        thread={[
          msg({ id: "out", fromAgentId: SELF, toAgentId: "peer-1", text: "sent" }),
          msg({ id: "unread", fromAgentId: "peer-1", toAgentId: SELF, text: "unread", read: false }),
          msg({ id: "read", fromAgentId: "peer-1", toAgentId: SELF, text: "seen", read: true }),
        ]}
        onSelectMsg={vi.fn()}
      />,
    );

    expect(screen.getByTestId("node-msg-out").dataset.status).toBe("saved");
    expect(screen.getByTestId("node-msg-unread").dataset.status).toBe("warn");
    expect(screen.getByTestId("node-msg-read").dataset.status).toBe("done");
  });

  it("calls onSelectMsg when a message node is clicked", async () => {
    const onSelectMsg = vi.fn();
    render(
      <InboxGraph
        peerId="peer-1"
        thread={[msg({ id: "m1", text: "hello", fromAgentId: SELF, toAgentId: "peer-1" })]}
        onSelectMsg={onSelectMsg}
      />,
    );

    await userEvent.click(screen.getByText("hello"));
    expect(onSelectMsg).toHaveBeenCalledWith("msg-m1");
  });

  it("does not call onSelectMsg when a non-message node is clicked", async () => {
    const onSelectMsg = vi.fn();
    render(
      <InboxGraph
        peerId="peer-1"
        thread={[msg({ id: "m1", text: "hello", fromAgentId: SELF, toAgentId: "peer-1" })]}
        onSelectMsg={onSelectMsg}
      />,
    );

    await userEvent.click(screen.getByText("You"));
    expect(onSelectMsg).not.toHaveBeenCalled();
  });

  it("renders the flow legend", () => {
    render(
      <InboxGraph
        peerId="peer-1"
        thread={[msg({ id: "m1", text: "hello", fromAgentId: SELF, toAgentId: "peer-1" })]}
        onSelectMsg={vi.fn()}
      />,
    );

    expect(screen.getByText(/sent →/)).toBeInTheDocument();
    expect(screen.getByText(/received → you/)).toBeInTheDocument();
    expect(screen.getByText(/unread/)).toBeInTheDocument();
  });
});
