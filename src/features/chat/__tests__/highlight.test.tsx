// highlight — dependency-free syntax highlighter. Tests language detection and
// the tokenized spans emitted for JSON, Python, shell, and plain text.

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HighlightedCode, detectLang } from "../highlight";

describe("detectLang", () => {
  it("detects JSON by leading brace/bracket", () => {
    expect(detectLang('{"a": 1}')).toBe("json");
    expect(detectLang("[1, 2]")).toBe("json");
  });

  it("detects Python by keywords", () => {
    expect(detectLang("def foo():\n  return 1")).toBe("python");
    expect(detectLang("import os\nprint('hi')")).toBe("python");
  });

  it("detects shell by leading command tokens", () => {
    expect(detectLang("cd /tmp")).toBe("shell");
    expect(detectLang("$ npm install")).toBe("shell");
    expect(detectLang("sudo ls -la")).toBe("shell");
  });

  it("falls back to plain", () => {
    expect(detectLang("just some words")).toBe("plain");
    expect(detectLang("   ")).toBe("plain");
    expect(detectLang("")).toBe("plain");
  });
});

describe("HighlightedCode", () => {
  it("renders JSON keys and strings as distinct token classes", () => {
    render(<HighlightedCode code={'{"name": "Sophos", "count": 3}'} lang="json" />);
    const keys = document.querySelectorAll(".hl-tok--key");
    const strings = document.querySelectorAll(".hl-tok--string");
    expect(keys.length).toBeGreaterThan(0);
    expect(strings.length).toBeGreaterThan(0);
  });

  it("renders Python keywords and comments", () => {
    render(<HighlightedCode code={'# a comment\ndef run():\n    return "x"' } lang="python" />);
    expect(document.querySelectorAll(".hl-tok--comment").length).toBeGreaterThan(0);
    expect(document.querySelectorAll(".hl-tok--func").length).toBeGreaterThan(0);
  });

  it("renders shell comments, strings, and flags", () => {
    render(<HighlightedCode code={'# note\necho "hi" --force' } lang="shell" />);
    expect(document.querySelectorAll(".hl-tok--comment").length).toBeGreaterThan(0);
    expect(document.querySelectorAll(".hl-tok--string").length).toBeGreaterThan(0);
    expect(document.querySelectorAll(".hl-tok--keyword").length).toBeGreaterThan(0);
  });

  it("emits a single plain token for plain text", () => {
    render(<HighlightedCode code="hello world" lang="plain" />);
    expect(document.querySelectorAll(".hl-tok--plain").length).toBeGreaterThan(0);
  });

  it("auto-detects the language when none is provided", () => {
    render(<HighlightedCode code='{"auto": true}' />);
    expect(document.querySelectorAll(".hl-tok--key").length).toBeGreaterThan(0);
  });
});
