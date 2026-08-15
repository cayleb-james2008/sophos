// layout.test.ts — dagre-based auto-layout. Covers rank direction, spacing,
// edge handling (unknown targets ignored), and that every node receives a
// top-left position.

import { describe, expect, it } from "vitest";
import { dagreLayout, type LayoutOptions, type RankDir } from "../layout";

const NODES = [
  { id: "a", width: 100, height: 40 },
  { id: "b", width: 120, height: 50 },
  { id: "c", width: 80, height: 30 },
];

describe("dagreLayout", () => {
  it("returns a position for every node in the list", () => {
    const pos = dagreLayout(NODES, [{ source: "a", target: "b" }]);
    for (const n of NODES) {
      expect(pos.get(n.id)).toBeDefined();
      expect(pos.get(n.id)!.x).toBeTypeOf("number");
      expect(pos.get(n.id)!.y).toBeTypeOf("number");
    }
    expect(pos.size).toBe(NODES.length);
  });

  it("lays a straight parent->child chain top-to-bottom by default", () => {
    const pos = dagreLayout(
      [
        { id: "a", width: 100, height: 40 },
        { id: "b", width: 100, height: 40 },
      ],
      [{ source: "a", target: "b" }],
    );
    // In TB layout the child sits below the parent (greater y), roughly
    // centered on the same x.
    const a = pos.get("a")!;
    const b = pos.get("b")!;
    expect(b.y).toBeGreaterThan(a.y);
    expect(Math.abs(b.x - a.x)).toBeLessThan(60);
  });

  it("lays left-to-right when rankdir is LR (child to the right)", () => {
    const pos = dagreLayout(
      [
        { id: "a", width: 100, height: 40 },
        { id: "b", width: 100, height: 40 },
      ],
      [{ source: "a", target: "b" }],
      { rankdir: "LR" },
    );
    const a = pos.get("a")!;
    const b = pos.get("b")!;
    expect(b.x).toBeGreaterThan(a.x);
  });

  it("respects ranksep (vertical gap between ranks in TB)", () => {
    const tight = dagreLayout(
      [
        { id: "a", width: 100, height: 40 },
        { id: "b", width: 100, height: 40 },
      ],
      [{ source: "a", target: "b" }],
      { ranksep: 10 },
    );
    const loose = dagreLayout(
      [
        { id: "a", width: 100, height: 40 },
        { id: "b", width: 100, height: 40 },
      ],
      [{ source: "a", target: "b" }],
      { ranksep: 200 },
    );
    const gapTight = tight.get("b")!.y - tight.get("a")!.y;
    const gapLoose = loose.get("b")!.y - loose.get("a")!.y;
    expect(gapLoose).toBeGreaterThan(gapTight);
  });

  it("ignores edges whose source or target is not a laid-out node", () => {
    const pos = dagreLayout(
      NODES,
      [
        { source: "a", target: "ghost" },
        { source: "ghost", target: "b" },
        { source: "a", target: "b" },
      ],
    );
    // No crash; only known nodes are positioned.
    expect(pos.size).toBe(NODES.length);
    expect(pos.get("ghost")).toBeUndefined();
  });

  it("positions disconnected nodes (no edges)", () => {
    const pos = dagreLayout(NODES, []);
    for (const n of NODES) expect(pos.get(n.id)).toBeDefined();
  });

  it("honours custom nodesep / margin overrides without error", () => {
    const opts: LayoutOptions = { rankdir: "LR", nodesep: 8, ranksep: 12, marginx: 4, marginy: 4 };
    const pos = dagreLayout(NODES, [{ source: "a", target: "b" }], opts);
    expect(pos.size).toBe(NODES.length);
  });

  it("handles an empty node list", () => {
    const pos = dagreLayout([], []);
    expect(pos.size).toBe(0);
  });

  it("produces deterministic output for the same input", () => {
    const edges = [
      { source: "a", target: "b" },
      { source: "b", target: "c" },
    ];
    const first = dagreLayout(NODES, edges, { rankdir: "TB" as RankDir });
    const second = dagreLayout(NODES, edges, { rankdir: "TB" as RankDir });
    for (const n of NODES) {
      expect(first.get(n.id)).toEqual(second.get(n.id));
    }
  });
});
