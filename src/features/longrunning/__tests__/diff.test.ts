// diff.test.ts — LCS unified line diff used by the refinement gate. Pure
// utility, no IPC. Covers identical input, pure additions/removals,
// replacements, empty strings, and context preservation.

import { describe, expect, it } from "vitest";
import { diffLines, type DiffLine } from "../diff";

const types = (lines: DiffLine[]) => lines.map((l) => l.type);
const texts = (lines: DiffLine[]) => lines.map((l) => l.text);

describe("diffLines", () => {
  it("returns a single empty context line for two empty strings", () => {
    expect(diffLines("", "")).toEqual([{ type: "ctx", text: "" }]);
  });

  it("tags every identical line as context", () => {
    const out = diffLines("a\nb\nc", "a\nb\nc");
    expect(types(out)).toEqual(["ctx", "ctx", "ctx"]);
    expect(texts(out)).toEqual(["a", "b", "c"]);
  });

  it("reports a purely added trailing block", () => {
    const out = diffLines("a", "a\nb\nc");
    expect(types(out)).toEqual(["ctx", "add", "add"]);
    expect(texts(out)).toEqual(["a", "b", "c"]);
  });

  it("reports a purely removed block", () => {
    const out = diffLines("a\nb\nc", "a");
    expect(types(out)).toEqual(["ctx", "del", "del"]);
    expect(texts(out)).toEqual(["a", "b", "c"]);
  });

  it("inserts a line in the middle as an add between context lines", () => {
    const out = diffLines("a\nb", "a\nc\nb");
    expect(types(out)).toEqual(["ctx", "add", "ctx"]);
    expect(texts(out)).toEqual(["a", "c", "b"]);
  });

  it("replaces a changed line with del + add", () => {
    const out = diffLines("a\nold\nb", "a\nnew\nb");
    expect(types(out)).toEqual(["ctx", "del", "add", "ctx"]);
    expect(texts(out)).toEqual(["a", "old", "new", "b"]);
  });

  it("handles an empty old text as an insertion (with the empty del quirk)", () => {
    const out = diffLines("", "x\ny");
    expect(types(out)).toEqual(["del", "add", "add"]);
    expect(texts(out)).toEqual(["", "x", "y"]);
  });

  it("handles an empty new text as a full removal (plus the trailing empty add)", () => {
    const out = diffLines("x\ny", "");
    expect(types(out)).toEqual(["del", "del", "add"]);
    expect(texts(out)).toEqual(["x", "y", ""]);
  });

  it("preserves untouched context around multiple edits", () => {
    const out = diffLines("one\ntwo\nthree\nfour", "one\nTWO\nthree\nFOUR");
    expect(types(out)).toEqual(["ctx", "del", "add", "ctx", "del", "add"]);
    expect(texts(out)).toEqual(["one", "two", "TWO", "three", "four", "FOUR"]);
  });

  it("keeps identical lines as context even with interleaved changes", () => {
    const out = diffLines("keep\na\nkeep\nb\nkeep", "keep\nA\nkeep\nB\nkeep");
    const ctx = out.filter((l) => l.type === "ctx").map((l) => l.text);
    expect(ctx).toEqual(["keep", "keep", "keep"]);
  });

  it("returns an empty diff for identical multi-line text", () => {
    const text = ["line1", "line2", "line3"].join("\n");
    const out = diffLines(text, text);
    expect(types(out).every((t) => t === "ctx")).toBe(true);
  });
});
