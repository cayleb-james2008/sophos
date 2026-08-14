// EngineGraph — the live engine process topology: SIDECAR → DAEMON → workers.
// Nodes carry live status (daemon/sidecar from engine status, workers from the
// live RLM child fleet). Live connections pulse. Rendered in the Engine
// Terminal above the log stream.

import { useEffect, useMemo } from "react";
import { Handle, Position, useNodesState, type Edge, type Node, type NodeProps } from "@xyflow/react";
import { GraphFlow, NodeFrame, PulseEdge, dagreLayout, type PulseEdgeData } from "../graph";
import { tokens } from "../../design/tokens";
import type { RlmChild } from "../../ipc/contract";

const W = 200;
const H = 78;

type NodeKind = "sidecar" | "daemon" | "worker";

type EngineNodeData = {
  kind: NodeKind;
  label: string;
  status: string;
  subtitle?: string;
  mono?: string;
};

export type EngineGraphNode = Node<EngineNodeData, "engine">;

function kindLabel(k: NodeKind): string {
  return k === "sidecar" ? "SIDECAR" : k === "daemon" ? "DAEMON" : "WORKER";
}

function EngineNode({ data, selected }: NodeProps<EngineGraphNode>) {
  return (
    <NodeFrame
      kind={kindLabel(data.kind)}
      title={data.label}
      status={data.status}
      subtitle={data.subtitle}
      mono={data.mono}
      width={W}
      selected={selected}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </NodeFrame>
  );
}

const nodeTypes = { engine: EngineNode };
const edgeTypes = { pulse: PulseEdge };

function connStatus(alive?: boolean, preview = false): string {
  if (preview) return "idle";
  if (alive === undefined) return "connecting";
  return alive ? "connected" : "disconnected";
}

export interface EngineGraphProps {
  daemonAlive?: boolean;
  sidecarAlive?: boolean;
  workers: RlmChild[];
  preview?: boolean;
}

export function EngineGraph({ daemonAlive, sidecarAlive, workers, preview = false }: EngineGraphProps) {
  const layout = useMemo(() => {
    const sidecar: EngineGraphNode = {
      id: "sidecar",
      type: "engine",
      data: {
        kind: "sidecar",
        label: "Bridge",
        status: connStatus(sidecarAlive, preview),
        subtitle: "Node bridge sidecar",
        mono: preview ? "PREVIEW" : sidecarAlive ? "● online" : "○ offline",
      },
      position: { x: 0, y: 0 },
      width: W,
      height: H,
      style: { width: W },
    };
    const daemon: EngineGraphNode = {
      id: "daemon",
      type: "engine",
      data: {
        kind: "daemon",
        label: "Daemon",
        status: connStatus(daemonAlive, preview),
        subtitle: "Agent daemon process",
        mono: preview ? "PREVIEW" : daemonAlive ? "● online" : "○ offline",
      },
      position: { x: 0, y: 0 },
      width: W,
      height: H,
      style: { width: W },
    };

    const workerNodes: EngineGraphNode[] = workers.map((w) => ({
      id: `worker-${w.id}`,
      type: "engine",
      data: {
        kind: "worker",
        label: w.name ?? w.id,
        status: w.status,
        subtitle: w.summary ?? "RLM worker",
        mono: `${w.status.toUpperCase()}`,
      },
      position: { x: 0, y: 0 },
      width: W,
      height: H,
      style: { width: W },
    }));

    const edges: Edge[] = [];
    const live = (s: string) => s === "running" || s === "connected" || s === "active";
    edges.push({
      id: "bridge-daemon",
      source: "sidecar",
      target: "daemon",
      type: "pulse",
      data: { pulse: live(connStatus(daemonAlive, preview)) && !preview, color: tokens.color.accent, animated: live(connStatus(daemonAlive, preview)) && !preview } as PulseEdgeData,
    });
    for (const w of workers) {
      edges.push({
        id: `d-w-${w.id}`,
        source: "daemon",
        target: `worker-${w.id}`,
        type: "pulse",
        data: { pulse: live(w.status) && !preview, color: live(w.status) ? tokens.color.ok : tokens.color.line, animated: live(w.status) && !preview } as PulseEdgeData,
      });
    }

    const all = [sidecar, daemon, ...workerNodes];
    const pos = dagreLayout(
      all.map((n) => ({ id: n.id, width: n.width ?? W, height: n.height ?? H })),
      edges.map((e) => ({ source: e.source, target: e.target })),
      { rankdir: "LR", nodesep: 26, ranksep: 130, marginx: 30, marginy: 30 },
    );
    const positioned = all.map((n) => {
      const p = pos.get(n.id);
      return p ? { ...n, position: { x: p.x, y: p.y } } : n;
    });
    return { positioned, edges };
  }, [daemonAlive, sidecarAlive, workers, preview]);

  const [nodes, setNodes, onNodesChange] = useNodesState<EngineGraphNode>([]);
  useEffect(() => {
    setNodes(layout.positioned);
  }, [layout, setNodes]);

  return (
    <GraphFlow
      nodes={nodes}
      edges={layout.edges}
      onNodesChange={onNodesChange}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      minZoom={0.3}
      maxZoom={2}
    >
      <div className="pg-legend">
        <span><i className="pg-legend__swatch pg-legend__swatch--accent" />IPC link</span>
        <span><i className="pg-legend__swatch pg-legend__swatch--ok" />worker running</span>
        <span><i className="pg-legend__swatch pg-legend__swatch--err" />offline</span>
        {preview ? <span className="pg-legend__preview">browser preview</span> : null}
      </div>
    </GraphFlow>
  );
}
