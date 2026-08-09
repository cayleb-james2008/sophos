// AgentsGraph — the agent fleet rendered as a hierarchical node graph.
//
// Structure: OPERATOR (root) → DAEMON (relay) → daemon-backed agents → RLM
// children (attached to their parent, or the daemon). Nodes are status-colored
// instrument cards; live connections carry a traveling heartbeat dot. Node
// actions: attach/detach and message (opens the inspector thread).
//
// Wired to the same real IPC data as the old two-pane console (useAgents) so
// no functionality is lost — this is a representation change only. The parent
// (AgentsView) gates this mount until the fleet has loaded so the graph mounts
// fresh with settled data (the React Flow controlled-mode edge-drop that
// occurred when nodes/edges changed mid-flight is avoided).

import { useEffect, useMemo } from "react";
import {
  Handle,
  Position,
  useNodesState,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { GraphFlow, NodeFrame, PulseEdge, statusColor, dagreLayout, type PulseEdgeData } from "../graph";
import { tokens } from "../../design/tokens";
import type { AgentRow } from "./useAgents";
import type { ConnectionStatus } from "../../ipc/contract";
import { AttachIcon, DetachIcon, MessageIcon } from "./icons";
import { initials } from "../../features/sessions/format";
import "./agents.css";

const WIDTH = 244;

type NodeKind = "operator" | "daemon" | "agent" | "rlm";

type AgentNodeData = {
  kind: NodeKind;
  label: string;
  status: string;
  subtitle?: string;
  mono?: string;
  attached?: boolean;
  unread?: number;
  onAttach?: () => void;
  onMessage?: () => void;
};

export type AgentGraphNode = Node<AgentNodeData, "agent">;

const NODE_HEIGHT: Record<NodeKind, number> = {
  operator: 76,
  daemon: 98,
  agent: 132,
  rlm: 106,
};

function kindLabel(k: NodeKind): string {
  switch (k) {
    case "operator":
      return "ROOT";
    case "daemon":
      return "RELAY";
    case "agent":
      return "AGENT";
    case "rlm":
      return "RLM CHILD";
  }
}

function AgentNode({ data }: NodeProps<AgentGraphNode>) {
  const actions =
    data.kind === "agent" || data.kind === "rlm" ? (
      <>
        {data.attached ? (
          <button className="pg-btn pg-btn--danger" onClick={(e) => { e.stopPropagation(); data.onAttach?.(); }} title="Stop monitoring">
            <DetachIcon size={11} /> Detach
          </button>
        ) : (
          <button className="pg-btn pg-btn--accent" onClick={(e) => { e.stopPropagation(); data.onAttach?.(); }} title="Attach to relay">
            <AttachIcon size={11} /> Attach
          </button>
        )}
        <button className="pg-btn" onClick={(e) => { e.stopPropagation(); data.onMessage?.(); }} title="Open coordination thread">
          <MessageIcon size={11} /> Message
        </button>
      </>
    ) : undefined;

  return (
    <NodeFrame
      kind={kindLabel(data.kind)}
      title={data.kind === "operator" || data.kind === "daemon" ? data.label : initials(data.label)}
      status={data.status}
      subtitle={data.subtitle}
      mono={data.mono}
      width={WIDTH}
      corner={data.unread ? <span className="pg-pill">{data.unread} unread</span> : undefined}
      actions={actions}
    >
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </NodeFrame>
  );
}

const nodeTypes = { agent: AgentNode };
const edgeTypes = { pulse: PulseEdge };

function toConnStatus(status: ConnectionStatus): string {
  switch (status.kind) {
    case "connected":
      return "connected";
    case "connecting":
      return "connecting";
    case "reconnecting":
      return "reconnecting";
    case "disconnected":
      return "disconnected";
    default:
      return "idle";
  }
}

export interface AgentsGraphProps {
  rows: AgentRow[];
  connectionStatus: ConnectionStatus;
  attachedId?: string;
  unreadByAgent: (id: string) => number;
  onSelect: (id: string) => void;
  onAttach: (id: string) => void;
  onMessage: (id: string) => void;
}

export function AgentsGraph({
  rows,
  connectionStatus,
  attachedId,
  unreadByAgent,
  onSelect,
  onAttach,
  onMessage,
}: AgentsGraphProps) {
  const conn = toConnStatus(connectionStatus);
  const daemonDown = connectionStatus.kind === "disconnected";

  // Structural layout — keyed ONLY on stable inputs. `unreadByAgent` is a
  // recreated callback and is deliberately NOT a dependency: rebuilding the
  // node/edge arrays every time it changes reference causes React Flow v12 to
  // drop the rendered edges (controlled-mode async churn). Unread counts are
  // patched live below via useNodesState instead.
  const layout = useMemo(() => {
    const daemonAgents = rows.filter((r) => r.kind === "daemon");
    const rlm = rows.filter((r) => r.kind === "rlm");

    const operator: AgentGraphNode = {
      id: "operator",
      type: "agent",
      data: { kind: "operator", label: "Operator", status: conn, subtitle: daemonDown ? "Relay unreachable" : "Command center" },
      position: { x: 0, y: 0 },
      width: WIDTH,
      height: NODE_HEIGHT.operator,
      style: { width: WIDTH },
    };
    const daemon: AgentGraphNode = {
      id: "daemon",
      type: "agent",
      data: {
        kind: "daemon",
        label: "Daemon",
        status: conn,
        subtitle: connLabel(connectionStatus),
        mono: `relay ${daemonDown ? "● offline" : "● online"}`,
      },
      position: { x: 0, y: 0 },
      width: WIDTH,
      height: NODE_HEIGHT.daemon,
      style: { width: WIDTH },
    };

    const agentNodes: AgentGraphNode[] = daemonAgents.map((a) => ({
      id: a.id,
      type: "agent",
      data: {
        kind: "agent",
        label: a.name ?? a.id,
        status: a.status,
        subtitle: a.summary ?? (a.sessionId ? `session ${a.sessionId.slice(0, 8)}` : `${a.id.slice(0, 8).toUpperCase()}`),
        mono: `${a.id.slice(0, 10).toUpperCase()} · ${a.status}`,
        attached: attachedId === a.id,
        unread: unreadByAgent(a.id),
        onAttach: () => onAttach(a.id),
        onMessage: () => onMessage(a.id),
      },
      position: { x: 0, y: 0 },
      width: WIDTH,
      height: NODE_HEIGHT.agent,
      style: { width: WIDTH },
    }));

    const rlmNodes: AgentGraphNode[] = rlm.map((c) => ({
      id: c.id,
      type: "agent",
      data: {
        kind: "rlm",
        label: c.name ?? c.id,
        status: c.status,
        subtitle: c.summary ?? "RLM subagent",
        mono: `${c.id.slice(0, 10).toUpperCase()} · ${c.status}`,
        attached: attachedId === c.id,
        unread: unreadByAgent(c.id),
        onAttach: () => onAttach(c.id),
        onMessage: () => onMessage(c.id),
      },
      position: { x: 0, y: 0 },
      width: WIDTH,
      height: NODE_HEIGHT.rlm,
      style: { width: WIDTH },
    }));

    const all = [operator, daemon, ...agentNodes, ...rlmNodes];

    const edges: Edge[] = [];
    const pulseFor = (status: string) => status === "running" || status === "connected" || status === "active";
    const connPulse = connectionStatus.kind === "connected";

    edges.push({
      id: "op-daemon",
      source: "operator",
      target: "daemon",
      type: "pulse",
      data: { pulse: connPulse, color: pulseFor(conn) ? tokens.color.ok : statusColor(conn), animated: connPulse } as PulseEdgeData,
    });
    for (const a of daemonAgents) {
      edges.push({
        id: `d-${a.id}`,
        source: "daemon",
        target: a.id,
        type: "pulse",
        data: { pulse: pulseFor(a.status), color: pulseFor(a.status) ? tokens.color.ok : tokens.color.line, animated: pulseFor(a.status) } as PulseEdgeData,
      });
    }
    for (const c of rlm) {
      const parent = c.parentId && daemonAgents.some((a) => a.id === c.parentId) ? c.parentId : "daemon";
      edges.push({
        id: `r-${c.id}`,
        source: parent,
        target: c.id,
        type: "pulse",
        data: { pulse: pulseFor(c.status), color: pulseFor(c.status) ? tokens.color.ok : tokens.color.line, animated: pulseFor(c.status) } as PulseEdgeData,
      });
    }

    // Position with dagre, return positioned nodes + edges together.
    const pos = dagreLayout(
      all.map((n) => ({ id: n.id, width: n.width ?? WIDTH, height: n.height ?? NODE_HEIGHT[(n.data as AgentNodeData).kind] })),
      edges.map((e) => ({ source: e.source, target: e.target })),
      { rankdir: "TB", nodesep: 72, ranksep: 96 },
    );
    const positioned = all.map((n) => {
      const p = pos.get(n.id);
      return p ? { ...n, position: { x: p.x, y: p.y } } : n;
    });
    return { positioned, edges };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, attachedId, conn, connectionStatus.kind]);

  const [nodes, setNodes, onNodesChange] = useNodesState<AgentGraphNode>([]);

  // Apply the structural layout once it changes (mount / rows / connection).
  useEffect(() => {
    setNodes(layout.positioned);
  }, [layout, setNodes]);

  // Patch unread counts in place so live inbox changes never rebuild the
  // structural arrays (which would drop the rendered edges in v12).
  useEffect(() => {
    setNodes((prev) => {
      let changed = false;
      const next = prev.map((n) => {
        const d = n.data as AgentNodeData;
        if (d.kind === "agent" || d.kind === "rlm") {
          const u = unreadByAgent(n.id);
          if (d.unread !== u) {
            changed = true;
            return { ...n, data: { ...d, unread: u } };
          }
        }
        return n;
      });
      return changed ? next : prev;
    });
  }, [unreadByAgent, setNodes]);

  return (
    <GraphFlow
      nodes={nodes}
      edges={layout.edges}
      onNodesChange={onNodesChange}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      showMiniMap={false}
      onNodeClick={(id) => {
        const kind = layout.positioned.find((n) => n.id === id)?.data?.kind;
        if (kind === "agent" || kind === "rlm") onSelect(id);
      }}
    >
      <div className="pg-legend">
        <span>
          <i className="pg-legend__swatch" style={{ background: tokens.color.ok }} />
          <b>{rows.filter((r) => r.status === "running").length}</b> running
        </span>
        <span>
          <i className="pg-legend__swatch" style={{ background: tokens.color.textDim }} />
          idle / saved
        </span>
        <span>
          <i className="pg-legend__swatch" style={{ background: tokens.color.err }} />
          error
        </span>
        <span style={{ color: tokens.color.textDim }}>
          total <b>{rows.length}</b>
        </span>
      </div>
    </GraphFlow>
  );
}

function connLabel(status: ConnectionStatus): string {
  switch (status.kind) {
    case "connected":
      return "Relay online — agents reachable";
    case "connecting":
      return "Connecting to relay…";
    case "reconnecting":
      return "Reconnecting to relay…";
    case "disconnected":
      return status.reason ?? "Relay unreachable";
    default:
      return "Unknown relay state";
  }
}
