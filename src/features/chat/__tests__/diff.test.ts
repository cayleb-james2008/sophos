// diff — pure line-diff + file-edit detection utilities. Tests cover the LCS
// diff algorithm, the unified formatter, edit-tool detection, and the JSON
// input-shape recognizer (targeted replace vs full-file write), including
// malformed inputs and the large-input whole-file fallback.

import { describe, expect, it } from "vitest";
import {
  diffLines,
  formatUnified,
  isEditToolName,
  parseFileEdit,
} from "../diff";

describe("isEditToolName", () => {
  it("recognizes the conventional edit tool names", () => {
    for (const name of ["write_file", "edit_file", "str_replace", "str_replace_editor", "patch", "write"]) {
      expect(isEditToolName(name)).toBe(true);
    }
  });

  it("rejects non-edit tool names", () => {
    expect(isEditToolName("read_file")).toBe(false);
    expect(isEditToolName("web_search")).toBe(false);
    expect(isEditToolName("")).toBe(false);
  });
});

describe("diffLines", () => {
  it("returns an empty diff for two empty strings", () => {
    expect(diffLines("", "")).toEqual([]);
  });

  it("marks identical content entirely as context", () => {
    const out = diffLines("a\nb\nc", "a\nb\nc");
    expect(out.map((l) => l.type)).toEqual(["context", "context", "context"]);
    expect(out.map((l) => l.text)).toEqual(["a", "b", "c"]);
  });

  it("marks a whole insertion as adds", () => {
    const out = diffLines("", "x\ny");
    expect(out).toEqual([
      { type: "add", text: "x" },
      { type: "add", text: "y" },
    ]);
  });

  it("marks a whole deletion as removes", () => {
    const out = diffLines("x\ny", "");
    expect(out).toEqual([
      { type: "remove", text: "x" },
      { type: "remove", text: "y" },
    ]);
  });

  it("produces a minimal unified-style edit for a middle change", () => {
    const out = diffLines("a\nb\nc", "a\nx\nc");
    expect(out).toEqual([
      { type: "context", text: "a" },
      { type: "remove", text: "b" },
      { type: "add", text: "x" },
      { type: "context", text: "c" },
    ]);
  });

  it("normalizes CRLF line endings", () => {
    const out = diffLines("a\r\nb", "a\nb");
    expect(out.map((l) => l.type)).toEqual(["context", "context"]);
  });

  it("keeps a trailing empty line when the source text ends with a newline", () => {
    // splitLines("a\n") yields ["a", ""], so the trailing newline surfaces as a
    // phantom empty-line removal. Documenting current behavior.
    const out = diffLines("a\n", "a");
    expect(out).toEqual([
      { type: "context", text: "a" },
      { type: "remove", text: "" },
    ]);
  });

  it("falls back to a coarse whole-file replace for oversized inputs", () => {
    // b > MAX_LCS_LINES (2000) triggers the coarse path: every old line is a
    // removal and every new line an addition.
    const before = "same";
    const after = Array.from({ length: 2001 }, (_, i) => `line ${i}`).join("\n");
    const out = diffLines(before, after);
    expect(out[0]).toEqual({ type: "remove", text: "same" });
    expect(out[1]).toEqual({ type: "add", text: "line 0" });
    expect(out[out.length - 1]).toEqual({ type: "add", text: "line 2000" });
  });
});

describe("formatUnified", () => {
  it("emits a unified diff header and prefixed body lines", () => {
    const unified = formatUnified("a\nb", "a\nc", "src/x.ts");
    expect(unified).toBe("--- a/src/x.ts\n+++ b/src/x.ts\n a\n-b\n+c");
  });

  it("handles a pure addition with the file header", () => {
    const unified = formatUnified("", "x", "f.txt");
    expect(unified).toBe("--- a/f.txt\n+++ b/f.txt\n+x");
  });
});

describe("parseFileEdit", () => {
  it("returns null for undefined, empty, or invalid JSON input", () => {
    expect(parseFileEdit(undefined, "edit_file")).toBeNull();
    expect(parseFileEdit("", "edit_file")).toBeNull();
    expect(parseFileEdit("not json", "edit_file")).toBeNull();
  });

  it("returns null for non-object JSON (arrays, scalars)", () => {
    expect(parseFileEdit("[]", "edit_file")).toBeNull();
    expect(parseFileEdit("42", "edit_file")).toBeNull();
    expect(parseFileEdit("null", "edit_file")).toBeNull();
  });

  it("returns null when the shape is unrecognized", () => {
    expect(parseFileEdit('{"foo":"bar"}', "edit_file")).toBeNull();
  });

  it("parses a targeted replacement via file_path + old_string/new_string", () => {
    const edit = parseFileEdit(
      JSON.stringify({ file_path: "src/a.ts", old_string: "old", new_string: "new" }),
      "str_replace",
    );
    expect(edit).toEqual({ filePath: "src/a.ts", before: "old", after: "new", isNewFile: false });
  });

  it("parses a full-file write via content and marks it as a new file", () => {
    const edit = parseFileEdit(JSON.stringify({ path: "src/b.ts", content: "body" }), "write_file");
    expect(edit).toEqual({ filePath: "src/b.ts", before: "", after: "body", isNewFile: true });
  });

  it("accepts the camelCase filePath and file aliases", () => {
    expect(parseFileEdit(JSON.stringify({ filePath: "x.ts", content: "1" }), "t")).not.toBeNull();
    expect(parseFileEdit(JSON.stringify({ file: "y.ts", content: "1" }), "t")).not.toBeNull();
  });

  it("uses an empty file path when no path key is present", () => {
    const edit = parseFileEdit(JSON.stringify({ content: "1" }), "t");
    expect(edit).toEqual({ filePath: "", before: "", after: "1", isNewFile: true });
  });
});
