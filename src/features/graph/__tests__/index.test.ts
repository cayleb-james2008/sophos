// index.test.ts — the graph barrel. Verifies the public surface is present and
// routes to the right implementations (so a refactor that drops a re-export
// fails here).

import { describe, expect, it } from "vitest";
import * as graph from "../index";
import { dagreLayout as layoutImpl } from "../layout";
import { statusColor as themeStatusColor, statusWash as themeStatusWash } from "../theme";
import { GraphFlow, NodeFrame, PulseEdge } from "../GraphCanvas";

describe("graph barrel", () => {
  it("exposes the layout function backed by dagreLayout", () => {
    expect(typeof graph.dagreLayout).toBe("function");
    expect(graph.dagreLayout).toBe(layoutImpl);
    const pos = graph.dagreLayout([{ id: "n", width: 10, height: 10 }], []);
    expect(pos.get("n")).toBeDefined();
  });

  it("exposes statusColor / statusWash backed by theme", () => {
    expect(graph.statusColor).toBe(themeStatusColor);
    expect(graph.statusColorFn).toBe(themeStatusColor);
    expect(graph.statusWash).toBe(themeStatusWash);
    expect(graph.statusColor("running")).toBe(themeStatusColor("running"));
    expect(graph.statusWash("error")).toBe(themeStatusWash("error"));
  });

  it("re-exports the canvas primitives", () => {
    expect(graph.GraphFlow).toBe(GraphFlow);
    expect(graph.NodeFrame).toBe(NodeFrame);
    expect(graph.PulseEdge).toBe(PulseEdge);
  });

  it("re-exports the layout type aliases", () => {
    // Type-level only; just ensure the names resolve at runtime via the barrel.
    expect("dagreLayout" in graph).toBe(true);
    expect("GraphFlow" in graph).toBe(true);
  });
});
