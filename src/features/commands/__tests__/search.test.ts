// search.test.ts — the dependency-free fuzzy matcher used by the ⌘K palette.

import { describe, expect, it } from "vitest";
import { fuzzyScore, fuzzyRank } from "../search";

describe("fuzzyScore", () => {
  it("matches an exact prefix with a high score (prefix bonus)", () => {
    const m = fuzzyScore("ref", "refine");
    expect(m).not.toBeNull();
    expect(m!.score).toBeGreaterThanOrEqual(100);
    expect(m!.indices).toEqual([0, 1, 2]);
  });

  it("returns null when the query is not a subsequence", () => {
    expect(fuzzyScore("xyz", "refine")).toBeNull();
    expect(fuzzyScore("ref", "")).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(fuzzyScore("REF", "refine")).not.toBeNull();
    expect(fuzzyScore("ref", "REFINE")).not.toBeNull();
  });

  it("matches a non-contiguous subsequence (gaps allowed)", () => {
    // 'c' 'm' 'p' appear in "compact" in order but not contiguously.
    const m = fuzzyScore("cmp", "compact");
    expect(m).not.toBeNull();
    expect(m!.indices.length).toBe(3);
  });

  it("returns a neutral match for an empty query", () => {
    expect(fuzzyScore("", "anything")).toEqual({ score: 0, indices: [] });
    expect(fuzzyScore("   ", "anything")).toEqual({ score: 0, indices: [] });
  });

  it("gives consecutive runs a bonus over gapped matches", () => {
    const consecutive = fuzzyScore("com", "compact")!;
    // "cop" appears at indices 0,2,3 in "compact" (gapped).
    const gapped = fuzzyScore("cop", "compact")!;
    expect(consecutive.score).toBeGreaterThan(gapped.score);
  });

  it("gives word-boundary matches a bonus", () => {
    // The "cd" at the start of a word scores higher than a mid-word hit.
    const boundary = fuzzyScore("cd", "cd command")!;
    const mid = fuzzyScore("mm", "cd command")!;
    expect(boundary.score).toBeGreaterThan(mid.score);
  });
});

describe("fuzzyRank", () => {
  const items = [
    { id: 1, name: "compact context" },
    { id: 2, name: "refine plan" },
    { id: 3, name: "copy last message" },
  ];

  it("returns an empty list for an empty query", () => {
    expect(fuzzyRank("", items, (i) => i.name)).toEqual([]);
    expect(fuzzyRank("  ", items, (i) => i.name)).toEqual([]);
  });

  it("ranks best matches first", () => {
    const results = fuzzyRank("compact", items, (i) => i.name);
    expect(results[0].item.id).toBe(1);
    expect(results.length).toBe(1);
  });

  it("returns only items where the query is a subsequence", () => {
    const results = fuzzyRank("zzz", items, (i) => i.name);
    expect(results).toEqual([]);
  });

  it("orders by descending score when multiple match", () => {
    const results = fuzzyRank("co", items, (i) => i.name);
    // Both compact and copy match "co" — compact (prefix) should rank first.
    expect(results.length).toBe(2);
    expect(results[0].item.id).toBe(1);
    expect(results[1].item.id).toBe(3);
    const scores = results.map((r) => r.match.score);
    expect(scores[0]).toBeGreaterThanOrEqual(scores[1]);
  });

  it("carries the matched indices for highlight", () => {
    const [r] = fuzzyRank("ref", items, (i) => i.name);
    expect(r.match.indices.length).toBeGreaterThan(0);
    expect(r.item.id).toBe(2);
  });
});
