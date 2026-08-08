// dagre-based hierarchical auto-layout for the Sophos node graphs.
// Turns a flat node/edge list into a positioned graph (top-to-bottom or
// left-to-right) with instrument spacing.

import dagre from "dagre";

export type RankDir = "TB" | "LR";

export interface LayoutSpec {
  id: string;
  width: number;
  height: number;
}

export interface LayoutOptions {
  rankdir?: RankDir;
  /** Horizontal (or row) spacing between nodes in px. */
  nodesep?: number;
  /** Vertical (or column) spacing between ranks in px. */
  ranksep?: number;
  marginx?: number;
  marginy?: number;
}

const DEFAULTS: Required<LayoutOptions> = {
  rankdir: "TB",
  nodesep: 56,
  ranksep: 84,
  marginx: 32,
  marginy: 32,
};

/**
 * Lay out `nodes` with dagre given `edges` (source -> target). Returns a map
 * of node id -> top-left position (React Flow uses top-left origin).
 * Unknown nodes referenced only by edges are ignored; every node in `nodes`
 * receives a position.
 */
export function dagreLayout(
  nodes: LayoutSpec[],
  edges: { source: string; target: string }[],
  options: LayoutOptions = {},
): Map<string, { x: number; y: number }> {
  const o = { ...DEFAULTS, ...options };
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: o.rankdir,
    nodesep: o.nodesep,
    ranksep: o.ranksep,
    marginx: o.marginx,
    marginy: o.marginy,
  });

  for (const n of nodes) g.setNode(n.id, { width: n.width, height: n.height });
  for (const e of edges) {
    if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target);
  }

  dagre.layout(g);

  const out = new Map<string, { x: number; y: number }>();
  for (const n of nodes) {
    const p = g.node(n.id);
    if (!p) continue;
    out.set(n.id, { x: p.x - n.width / 2, y: p.y - n.height / 2 });
  }
  return out;
}
