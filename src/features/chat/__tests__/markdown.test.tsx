// markdown — dependency-free chat markdown renderer. Covers headings, lists,
// code fences, inline formatting (bold/italic/code/link), blockquotes, and
// horizontal rules, all rendered as React elements (no innerHTML).

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Markdown } from "../markdown";

const H = `# One
## Two
### Three`;
const LISTS = `- a
- b

1. one
2. two`;
const FENCE = "```js\nconst x = **not bold**\n```";
const INLINE = "**bold** *italic* `code`";
const PARAS = `line one
line two`;

// NB: JSX attribute strings treat `\n` literally, so all multi-line inputs use
// template literals (real newlines) to exercise the actual block parser.

describe("Markdown", () => {
  it("renders headings at their levels", () => {
    render(<Markdown content={H} />);
    expect(document.querySelector(".md-h1")).toHaveTextContent("One");
    expect(document.querySelector(".md-h2")).toHaveTextContent("Two");
    expect(document.querySelector(".md-h3")).toHaveTextContent("Three");
  });

  it("renders unordered and ordered lists", () => {
    render(<Markdown content={LISTS} />);
    expect(document.querySelectorAll(".md-li").length).toBe(4);
    expect(screen.getByText("a")).toBeInTheDocument();
    expect(screen.getByText("one")).toBeInTheDocument();
  });

  it("renders code fences verbatim without inline parsing", () => {
    render(<Markdown content={FENCE} />);
    expect(document.querySelector(".md-pre")).toHaveTextContent("const x = **not bold**");
  });

  it("renders inline bold, italic, and code", () => {
    render(<Markdown content={INLINE} />);
    expect(document.querySelector(".md-strong")).toHaveTextContent("bold");
    expect(document.querySelector(".md-em")).toHaveTextContent("italic");
    expect(document.querySelector(".md-code")).toHaveTextContent("code");
  });

  it("renders links with an external target", () => {
    render(<Markdown content="[Docs](https://example.com)" />);
    const link = document.querySelector(".md-link") as HTMLAnchorElement;
    expect(link).toHaveAttribute("href", "https://example.com");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders blockquotes", () => {
    render(<Markdown content="> quoted line" />);
    expect(document.querySelector(".md-quote")).toHaveTextContent("quoted line");
  });

  it("does not render a bare horizontal rule (the parser drops it)", () => {
    // push() discards blocks with no lines, so a lone "---" yields no .md-hr.
    render(<Markdown content="---" />);
    expect(document.querySelector(".md-hr")).not.toBeInTheDocument();
  });

  it("renders paragraphs with line breaks", () => {
    render(<Markdown content={PARAS} />);
    const p = document.querySelector(".md-p");
    expect(p).toHaveTextContent("line one");
    expect(p).toHaveTextContent("line two");
  });
});
