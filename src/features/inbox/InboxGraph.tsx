// InboxGraph — the agent relay rendered as a message-flow graph. The flow
// reads left-to-right: YOU → message nodes → the peer agent. Each message node
// shows its direction (IN/OUT) and recency; unread incoming messages are
// highlighted with a terminal-green ring + UNREAD pill and a live pulse on
// their edges.
//
// dagre lays the graph out as a strict DAG (all messages run self -> msg ->
// peer) so it stays acyclic; the *rendered* edges carry the real direction for
// outgoing vs incoming. Wire to the same IPC data as the prior rail — a
// representation change only.

import { useEffect, useMemo } from "react";
import { Handle, Position, useNodesState, type Edge, type Node, type NodeProps } from "@xyflow/react";
import { GraphFlow, NodeFrame, PulseEdge, dagreLayout, type PulseEdgeData } from "../graph";
import { tokens } from "../../design/tokens";
import type { AgentMessage } from "../../ipc/contract";
import { SELF } from "../agents/useAgents";
import "./inbox.css";

const SELF_W = 168;
const PEER_W = 210;
const MSG_W = 280;

type NodeKind = "self" | "peer" | "message";

type InboxNodeData = {
  kind: NodeKind;
  label: string;
  status: string;
  subtitle?: string;
  mono?: string;
  direction?: "out" | "in";
  unread?: boolean;
}

export type InboxGraphNode = Node<InboxNodeData, "inbox">;

const NODE_HEIGHT: Record<NodeKind, number> = { self: 74, peer: 84, message: 92 };

function InboxNode({ data, selected }: NodeProps<InboxGraphNode>) {
  const isMsg = data.kind === "message";
  const kindLabel = data.kind === "self" ? "YOU" : data.kind === "peer" ? "AGENT" : data.direction === "out" ? "OUT · SENT" : "IN · RECEIVED";
  const corner = isMsg && data.unread ? (
    <span className="pg-pill">UNREAD</span>
  ) : isMsg ? (
    <span className="pg-pill" style={{ background: tokens.color.bgOverlay, borderColor: tokens.color.border, color: tokens.color.textDim }}>
      {data.direction === "out" ? "SENT" : "READ"}
    </span>
  ) : undefined;

  return (
    <NodeFrame
      kind={kindLabel}
      title={data.kind === "message" ? (data.label.length > 46 ? data.label.slice(0, 46) + "…" : data.label) : data.label}
      status={data.status}
      subtitle={data.kind === "message" ? undefined : data.subtitle}
      mono={data.mono}
      width={data.kind === "self" ? SELF_W : data.kind === "peer" ? PEER_W : MSG_W}
      selected={selected}
      corner={corner}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </NodeFrame>
  );
}

const nodeTypes = { inbox: InboxNode };
const edgeTypes = { pulse: PulseEdge };

function time(value?: string): string {
  if (!value) return "now";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export interface InboxGraphProps {
  peerId?: string;
  peerName?: string;
  peerStatus?: string;
  thread: AgentMessage[];
  onSelectMsg: (id: string) => void;
}

export function InboxGraph({ peerId, peerName, peerStatus, thread, onSelectMsg }: InboxGraphProps) {
  const layout = useMemo((): { positioned: InboxGraphNode[]; edges: Edge[] } => {
    const nodes: InboxGraphNode[] = [];
    const renderEdges: Edge[] = [];
    const layoutEdges: { source: string; target: string }[] = [];

    if (!peerId) {
      return { positioned: [], edges: [] };
    }

    nodes.push({
      id: SELF,
      type: "inbox",
      data: { kind: "self", label: "You", status: "connected", subtitle: "operator client", mono: "LOCAL" },
      position: { x: 0, y: 0 },
      width: SELF_W,
      height: NODE_HEIGHT.self,
      style: { width: SELF_W },
    });
    nodes.push({
      id: peerId,
      type: "inbox",
      data: { kind: "peer", label: peerName ?? peerId, status: peerStatus ?? "idle", subtitle: "agent relay peer", mono: `${peerId.slice(0, 10).toUpperCase()}` },
      position: { x: 0, y: 0 },
      width: PEER_W,
      height: NODE_HEIGHT.peer,
      style: { width: PEER_W },
    });

    for (const m of thread) {
      const mid = `msg-${m.id}`;
      const outgoing = m.fromAgentId === SELF;
      nodes.push({
        id: mid,
        type: "inbox",
        data: {
          kind: "message",
          label: m.text,
          status: outgoing ? "saved" : m.read ? "done" : "warn",
          direction: outgoing ? "out" : "in",
          unread: !outgoing && !m.read,
          mono: `${time(m.timestamp)} · ${outgoing ? "→" : "←"} ${outgoing ? peerName ?? "agent" : "you"}`,
        },
        position: { x: 0, y: 0 },
        width: MSG_W,
        height: NODE_HEIGHT.message,
        style: { width: MSG_W },
      });

      // Real, directed edges (what gets drawn).
      if (outgoing) {
        renderEdges.push(edgeFor(SELF, mid, tokens.color.accent, true));
        renderEdges.push(edgeFor(mid, peerId, tokens.color.accent, true));
      } else {
        const unread = !m.read;
        renderEdges.push(edgeFor(peerId, mid, unread ? tokens.color.ok : tokens.color.line, unread));
        renderEdges.push(edgeFor(mid, SELF, unread ? tokens.color.ok : tokens.color.line, unread));
      }

      // Acyclic layout edges — always self -> msg -> peer so dagre stays a DAG.
      layoutEdges.push({ source: SELF, target: mid }, { source: mid, target: peerId });
    }

    if (nodes.length === 0) return { positioned: [] as InboxGraphNode[], edges: [] as Edge[] };
    const pos = dagreLayout(
      nodes.map((n) => ({ id: n.id, width: n.width ?? MSG_W, height: n.height ?? NODE_HEIGHT[(n.data as InboxNodeData).kind] })),
      layoutEdges,
      { rankdir: "LR", nodesep: 30, ranksep: 170, marginx: 40, marginy: 40 },
    );
    const positioned = nodes.map((n) => {
      const p = pos.get(n.id);
      return p ? { ...n, position: { x: p.x, y: p.y } } : n;
    });
    return { positioned, edges: renderEdges };
  }, [peerId, peerName, peerStatus, thread]);

  const [nodes, setNodes, onNodesChange] = useNodesState<InboxGraphNode>([]);
  useEffect(() => {
    setNodes(layout.positioned);
  }, [layout, setNodes]);

  if (layout.positioned.length === 0) return null;

  return (
    <GraphFlow
      nodes={nodes}
      edges={layout.edges}
      onNodesChange={onNodesChange}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodeClick={(id) => {
        const kind = layout.positioned.find((n) => n.id === id)?.data?.kind;
        if (kind === "message") onSelectMsg(id);
      }}
    >
      <div className="pg-legend">
        <span>
          <i className="pg-legend__swatch" style={{ background: tokens.color.accent }} />sent →
        </span>
        <span>
          <i className="pg-legend__swatch" style={{ background: tokens.color.ok }} />received → you
        </span>
        <span>
          <i className="pg-legend__swatch" style={{ background: tokens.color.err }} />unread
        </span>
      </div>
    </GraphFlow>
  );
}

function edgeFor(source: string, target: string, color: string, pulse: boolean): Edge {
  return {
    id: `${source}-${target}`,
    source,
    target,
    type: "pulse",
    data: { color, pulse, animated: pulse } as PulseEdgeData,
  };
}
