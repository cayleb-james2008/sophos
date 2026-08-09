// SessionsGraph — sessions rendered as a node graph. Each session is an
// instrument card carrying a context-usage ring; edges flow to its goals and
// RLM children. Actions: resume / fork on the session node.
//
// Wired to the same real IPC data as the prior rail (listSessions + per-session
// context / goals / rlmChildren enrichment) — a representation change only.

import { useEffect, useMemo } from "react";
import { Handle, Position, useNodesState, type Edge, type Node, type NodeProps } from "@xyflow/react";
import { GraphFlow, NodeFrame, PulseEdge, dagreLayout, type PulseEdgeData } from "../graph";
import { tokens } from "../../design/tokens";
import type { SessionInfo, ContextStats, Goal, RlmChild } from "../../ipc/contract";
import { formatTokens } from "./format";
import "./sessions.css";

const WIDTH = 252;
const GOAL_W = 238;
const RLM_W = 234;

type NodeKind = "session" | "goal" | "rlm";

type SessionNodeData = {
  kind: NodeKind;
  label: string;
  status: string;
  subtitle?: string;
  mono?: string;
  ring?: { tokens?: number; window?: number; messages?: number };
  onResume?: () => void;
  onFork?: () => void;
  onSelect?: () => void;
};

export type SessionGraphNode = Node<SessionNodeData, "session">;

const NODE_HEIGHT: Record<NodeKind, number> = { session: 138, goal: 92, rlm: 100 };

export interface SessionEnrichment {
  context?: ContextStats;
  goals?: Goal[];
  rlmChildren?: RlmChild[];
}

function kindLabel(k: NodeKind): string {
  return k === "session" ? "SESSION" : k === "goal" ? "GOAL" : "RLM CHILD";
}

function SessionNode({ data, selected }: NodeProps<SessionGraphNode>) {
  return (
    <NodeFrame
      kind={kindLabel(data.kind)}
      title={data.label}
      status={data.status}
      subtitle={data.subtitle}
      mono={data.mono}
      width={data.kind === "goal" ? GOAL_W : data.kind === "rlm" ? RLM_W : WIDTH}
      selected={selected}
      corner={
        data.ring ? (
          <ContextRing tokens={data.ring.tokens} window={data.ring.window} messages={data.ring.messages} />
        ) : undefined
      }
      actions={
        data.kind === "session"
          ? [
              <button key="r" className="pg-btn" onClick={(e) => { e.stopPropagation(); data.onResume?.(); }} title="Resume session">
                Resume
              </button>,
              <button key="f" className="pg-btn pg-btn--accent" onClick={(e) => { e.stopPropagation(); data.onFork?.(); }} title="Fork session">
                Fork
              </button>,
            ]
          : undefined
      }
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </NodeFrame>
  );
}

function ContextRing({ tokens: t, window: w, messages }: { tokens?: number; window?: number; messages?: number }) {
  const r = 18;
  const c = 2 * Math.PI * r;
  const frac = t && w ? Math.min(1, t / w) : 0;
  const offset = c * (1 - frac);
  return (
    <svg width="46" height="46" viewBox="0 0 46 46" className="pg-ring" role="img" aria-label={`Context ${frac * 100}% used`}>
      <circle className="pg-ring__track" cx="23" cy="23" r={r} />
      <circle
        className="pg-ring__fill"
        cx="23"
        cy="23"
        r={r}
        strokeDasharray={c}
        strokeDashoffset={offset}
        transform="rotate(-90 23 23)"
      />
      <text className="pg-ring__label" x="23" y="25">
        {formatTokens(t)}
      </text>
      <text className="pg-ring__sub" x="23" y="34">
        {w ? `/${formatTokens(w)}` : "—"}
      </text>
      {messages !== undefined ? <text className="pg-ring__sub" x="23" y="7"></text> : null}
    </svg>
  );
}

const nodeTypes = { session: SessionNode };
const edgeTypes = { pulse: PulseEdge };

function goalStatus(s: Goal["status"]): string {
  switch (s) {
    case "active":
      return "running";
    case "paused":
      return "paused";
    case "completed":
      return "done";
    case "cleared":
      return "idle";
    default:
      return "idle";
  }
}

export interface SessionsGraphProps {
  sessions: SessionInfo[];
  enrichment: Record<string, SessionEnrichment>;
  activeSessionId?: string;
  daemonDown: boolean;
  onSelect: (id: string) => void;
  onResume: (id: string) => void;
  onFork: (id: string) => void;
}

export function SessionsGraph({
  sessions,
  enrichment,
  activeSessionId,
  daemonDown,
  onSelect,
  onResume,
  onFork,
}: SessionsGraphProps) {
  const layout = useMemo(() => {
    const nodes: SessionGraphNode[] = [];
    const edges: Edge[] = [];

    const isActive = (id: string) => id === activeSessionId;

    for (const s of sessions) {
      const en = enrichment[s.id] ?? {};
      const ring =
        en.context && en.context.contextWindow
          ? { tokens: en.context.tokens, window: en.context.contextWindow, messages: en.context.messages }
          : undefined;
      const sessionStatus = isActive(s.id) ? "active" : s.status ?? "idle";

      nodes.push({
        id: s.id,
        type: "session",
        data: {
          kind: "session",
          label: s.title ?? s.id,
          status: sessionStatus,
          subtitle: s.cwd ?? `session ${s.id.slice(0, 8)}`,
          mono: `${s.id.slice(0, 10).toUpperCase()} · ${sessionStatus}`,
          ring,
          onResume: () => onResume(s.id),
          onFork: () => onFork(s.id),
        },
        position: { x: 0, y: 0 },
        width: WIDTH,
        height: NODE_HEIGHT.session,
        style: { width: WIDTH },
      });

      const goals = en.goals ?? [];
      const rlm = en.rlmChildren ?? [];
      for (const g of goals) {
        const gid = `goal-${s.id}-${g.id}`;
        nodes.push({
          id: gid,
          type: "session",
          data: { kind: "goal", label: g.objective, status: goalStatus(g.status), subtitle: g.progress ? `progress · ${g.progress}` : g.status },
          position: { x: 0, y: 0 },
          width: GOAL_W,
          height: NODE_HEIGHT.goal,
          style: { width: GOAL_W },
        });
        edges.push(edgeFor(s.id, gid, goalStatus(g.status) === "running"));
      }
      for (const c of rlm) {
        const cid = `rlm-${s.id}-${c.id}`;
        nodes.push({
          id: cid,
          type: "session",
          data: { kind: "rlm", label: c.name ?? c.id, status: c.status, subtitle: c.summary ?? "RLM subagent" },
          position: { x: 0, y: 0 },
          width: RLM_W,
          height: NODE_HEIGHT.rlm,
          style: { width: RLM_W },
        });
        edges.push(edgeFor(s.id, cid, c.status === "running"));
      }
    }

    if (nodes.length === 0) return { positioned: [] as SessionGraphNode[], edges: [] as Edge[] };

    const pos = dagreLayout(
      nodes.map((n) => ({
        id: n.id,
        width: n.width ?? WIDTH,
        height: n.height ?? NODE_HEIGHT[(n.data as SessionNodeData).kind],
      })),
      edges.map((e) => ({ source: e.source, target: e.target })),
      { rankdir: "LR", nodesep: 34, ranksep: 120, marginx: 40, marginy: 40 },
    );
    const positioned = nodes.map((n) => {
      const p = pos.get(n.id);
      return p ? { ...n, position: { x: p.x, y: p.y } } : n;
    });
    return { positioned, edges };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, enrichment, activeSessionId]);

  const [nodes, setNodes, onNodesChange] = useNodesState<SessionGraphNode>([]);
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
      /* The session tree is laid out to fit the canvas, so a mini-map added no
         navigational value and read as a stray UI element mid-canvas
         (vision-critic D2). Matches the Agents fleet graph. */
      showMiniMap={false}
      onNodeClick={(id) => {
        const kind = layout.positioned.find((n) => n.id === id)?.data?.kind;
        if (kind === "session") onSelect(id);
      }}
    >
      <div className="pg-legend">
        <span>
          <i className="pg-legend__swatch" style={{ background: tokens.color.ok }} />active session
        </span>
        <span>
          <i className="pg-legend__swatch" style={{ background: tokens.color.textDim }} />saved / background
        </span>
        <span>
          <i className="pg-legend__swatch" style={{ background: tokens.color.accent }} />context ring
        </span>
        {daemonDown ? (
          <span style={{ color: tokens.color.err }}>
            <i className="pg-legend__swatch" style={{ background: tokens.color.err }} />daemon offline
          </span>
        ) : null}
      </div>
    </GraphFlow>
  );
}

function edgeFor(source: string, target: string, pulse: boolean): Edge {
  return {
    id: `${source}-${target}`,
    source,
    target,
    type: "pulse",
    data: { pulse, color: pulse ? tokens.color.ok : tokens.color.line, animated: pulse } as PulseEdgeData,
  };
}
