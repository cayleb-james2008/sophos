// Shared node-graph primitives — the reusable instrument chrome every graph
// view is built from. Exposes:
//   - NodeFrame: the hairline-ruled node card with a status rail + dot
//   - PulseEdge: an edge with a traveling heartbeat dot for live connections
//   - GraphFlow: a pre-styled <ReactFlow> with grid + controls + minimap
//
// React Flow's own stylesheet is imported here once so custom nodes render on
// the standard primitives.

import { motion, MotionConfig, useReducedMotion } from "framer-motion";
import type { CSSProperties, ReactNode } from "react";
import {
  Background,
  BaseEdge,
  ControlButton,
  Controls,
  getSmoothStepPath,
  MiniMap,
  ReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { statusColor, statusWash, LINE } from "./theme";
import { tokens } from "../../design/tokens";
import "./graph.css";

// ---------------------------------------------------------------------------
// NodeFrame — the instrument card
// ---------------------------------------------------------------------------

export interface NodeFrameProps {
  kind: string;
  title: string;
  status: string;
  subtitle?: string;
  mono?: string;
  actions?: ReactNode;
  corner?: ReactNode;
  width?: number;
  selected?: boolean;
  onClick?: () => void;
  children?: ReactNode;
  style?: CSSProperties;
}

export function NodeFrame({
  kind,
  title,
  status,
  subtitle,
  mono,
  actions,
  corner,
  width = 232,
  selected = false,
  onClick,
  children,
  style,
}: NodeFrameProps) {
  const color = statusColor(status);
  const enterEase = [0.16, 1, 0.3, 1] as const;
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92, y: 4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.3, ease: enterEase }}
    >
      <div className={`pg-node ${selected ? "pg-node--sel" : ""}`} style={{ "--node-w": `${width}px`, ...style } as CSSProperties} onClick={onClick}>
        <span className="pg-node__edge" style={{ "--node-color": color } as CSSProperties} />
        <div className="pg-node__head">
          <span className="pg-node__kind">{kind}</span>
          {corner ?? <span className="pg-node__dot" style={{ "--node-color": color, "--node-wash": statusWash(status) } as CSSProperties} />}
        </div>
        <div className="pg-node__title" title={title}>
          {title}
        </div>
        {subtitle ? (
          <div className="pg-node__sub" title={subtitle}>
            {subtitle}
          </div>
        ) : null}
        {mono ? <div className="pg-node__mono">{mono}</div> : null}
        {children}
        {actions ? <div className="pg-actions">{actions}</div> : null}
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// PulseEdge — a quiet edge whose active connections carry a heartbeat dot
// ---------------------------------------------------------------------------

export type PulseEdgeData = {
  color?: string;
  /** Render a traveling heartbeat dot when the connection is live. */
  pulse?: boolean;
  /** Render a flowing dash animation on the stroke itself. */
  animated?: boolean;
};

export function PulseEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  data,
}: EdgeProps) {
  const d = (data ?? {}) as PulseEdgeData;
  const reduced = useReducedMotion();
  const [path] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 0, // sharp — P4 critic fix
  });
  const color = d.color ?? LINE;
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        className={d.animated ? "pg-animated" : undefined}
        style={{ "--edge-color": color, ...style } as CSSProperties}
      />
      {d.pulse && !reduced ? (
        <circle r={2.6} fill={color}>
          <animateMotion dur="1.5s" repeatCount="indefinite" path={path} calcMode="linear" />
        </circle>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// GraphFlow — pre-styled <ReactFlow>
// ---------------------------------------------------------------------------

export interface GraphFlowProps {
  nodes: Node[];
  edges: Edge[];
  onNodeClick?: (id: string) => void;
  fitView?: boolean;
  minZoom?: number;
  maxZoom?: number;
  /** Toggle the minimap. Off lets a compact graph keep the canvas undivided. */
  showMiniMap?: boolean;
  children?: ReactNode;
  edgeTypes?: Record<string, unknown>;
  nodeTypes?: Record<string, unknown>;
  nodesConnectable?: boolean;
  nodesDraggable?: boolean;
  onNodesChange?: (changes: never) => void;
  onEdgesChange?: (changes: never) => void;
}

export function GraphFlow({
  nodes,
  edges,
  onNodeClick,
  fitView = true,
  minZoom = 0.2,
  maxZoom = 1.8,
  showMiniMap = true,
  children,
  edgeTypes,
  nodeTypes,
  nodesConnectable = false,
  nodesDraggable = true,
  onNodesChange,
  onEdgesChange,
}: GraphFlowProps) {
  return (
    <div className="pa-graph" data-nodes={nodes.length} data-edges={edges.length}>
      <div className="pa-graph__panel">
        <MotionConfig reducedMotion="user">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange as never}
          onEdgesChange={onEdgesChange as never}
          nodeTypes={nodeTypes as never}
          edgeTypes={edgeTypes as never}
          nodesConnectable={nodesConnectable}
          nodesDraggable={nodesDraggable}
          fitView={fitView}
          fitViewOptions={{ padding: 0.18, maxZoom: 1.15 }}
          minZoom={minZoom}
          maxZoom={maxZoom}
          proOptions={{ hideAttribution: true }}
          onNodeClick={(_, n) => onNodeClick?.(n.id)}
          colorMode="dark"
        >
          <Background gap={22} size={1.1} color={tokens.color.border} bgColor={tokens.color.bg} />
          <Controls position="bottom-right" showInteractive={false} className="pa-graph__controls">
            <ControlButton title="Zoom in" aria-label="Zoom in">
              <PlusGlyph />
            </ControlButton>
            <ControlButton title="Zoom out" aria-label="Zoom out">
              <MinusGlyph />
            </ControlButton>
            <ControlButton title="Fit view" aria-label="Fit view">
              <FitGlyph />
            </ControlButton>
          </Controls>
          {/* Minimap lives top-right so it never stacks on the zoom controls
              (bottom-right) — the D5 overlap fix. */}
          {showMiniMap ? (
            <MiniMap position="top-right" pannable zoomable nodeStrokeWidth={2} nodeColor={nodeColor} maskColor="rgba(14,14,14,0.6)" className="pa-graph__minimap" />
          ) : null}
          {children}
        </ReactFlow>
        </MotionConfig>
      </div>
    </div>
  );
}

function nodeColor(n: Node): string {
  const s = n.data?.status as string | undefined;
  const c = statusColor(s);
  return s === "running" || s === "connected" || s === "active" ? c : tokens.color.border;
}

function PlusGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
function MinusGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M3 6h6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
function FitGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M4 2H2v2M8 2h2v2M4 10H2V8M8 10h2V8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Handles + shared color re-exports
// ---------------------------------------------------------------------------

export { Handle, Position } from "@xyflow/react";
export { ACCENT, statusColor } from "./theme";
