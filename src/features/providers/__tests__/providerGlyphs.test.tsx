// providerGlyphs — small SVG glyphs per provider with a generic fallback.
// Pure presentational; asserts the right glyph shape (paths / circles) is
// emitted for each known provider and the generic chip for unknown ones.

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProviderGlyph } from "../providerGlyphs";

function glyphChildren(provider: string, size = 14) {
  const { container } = render(<ProviderGlyph provider={provider} size={size} />);
  const svg = container.querySelector("svg");
  return { svg, children: svg ? Array.from(svg.children) : [] };
}

describe("ProviderGlyph", () => {
  it("renders an aria-hidden svg at the requested size", () => {
    const { svg } = glyphChildren("ollama-cloud", 16);
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg?.getAttribute("width")).toBe("16");
    expect(svg?.getAttribute("height")).toBe("16");
  });

  it("renders the llama glyph (1 path + 2 eyes) for ollama", () => {
    const { children } = glyphChildren("ollama-cloud");
    const paths = children.filter((c) => c.tagName === "path");
    const circles = children.filter((c) => c.tagName === "circle");
    expect(paths).toHaveLength(1);
    expect(circles).toHaveLength(2);
  });

  it("renders the branching router (3 circles + 2 paths) for openrouter", () => {
    const { children } = glyphChildren("openrouter");
    expect(children.filter((c) => c.tagName === "circle")).toHaveLength(3);
    expect(children.filter((c) => c.tagName === "path")).toHaveLength(2);
  });

  it("renders opposing chevrons (2 paths) for minimax", () => {
    const { children } = glyphChildren("minimax");
    expect(children.filter((c) => c.tagName === "path")).toHaveLength(2);
    expect(children.filter((c) => c.tagName === "circle")).toHaveLength(0);
  });

  it("renders code brackets (2 paths) for codex / opencode", () => {
    expect(glyphChildren("codex").children.filter((c) => c.tagName === "path")).toHaveLength(2);
    expect(glyphChildren("opencode").children.filter((c) => c.tagName === "path")).toHaveLength(2);
  });

  it("renders the hexagon (1 path) for openai", () => {
    expect(glyphChildren("openai").children.filter((c) => c.tagName === "path")).toHaveLength(1);
  });

  it("renders the starburst (1 path) for anthropic / claude", () => {
    expect(glyphChildren("anthropic").children.filter((c) => c.tagName === "path")).toHaveLength(1);
    expect(glyphChildren("claude").children.filter((c) => c.tagName === "path")).toHaveLength(1);
  });

  it("renders the generic chip (1 rect + 1 circle) for unknown providers", () => {
    const { children } = glyphChildren("some-unknown-provider");
    expect(children.filter((c) => c.tagName === "rect")).toHaveLength(1);
    expect(children.filter((c) => c.tagName === "circle")).toHaveLength(1);
  });

  it("matches providers case-insensitively", () => {
    expect(glyphChildren("OLLAMA-CLOUD").children.filter((c) => c.tagName === "circle")).toHaveLength(2);
    expect(glyphChildren("OpenRouter").children.filter((c) => c.tagName === "circle")).toHaveLength(3);
  });

  it("passes the color through to the svg stroke", () => {
    const { container } = render(<ProviderGlyph provider="openai" size={12} color="#ff0000" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("stroke", "#ff0000");
  });
});
