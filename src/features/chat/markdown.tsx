// markdown — a lightweight, dependency-free markdown renderer for chat content.
// Handles the common chat subset: paragraphs, headings, lists, code blocks,
// inline code, bold, italic, links, blockquotes, and horizontal rules.
// Renders to React elements (no dangerouslySetInnerHTML) so it is XSS-safe.

import React from "react";
import { tokens } from "../../design/tokens";

type CSS = React.CSSProperties;

const codeStyle: CSS = {
  fontFamily: tokens.font.mono,
  fontSize: "0.9em",
  background: tokens.color.bgOverlay,
  border: `1px solid ${tokens.color.border}`,
  borderRadius: tokens.radius.sm,
  padding: "1px 5px",
  color: tokens.color.accentHover,
};

const preStyle: CSS = {
  fontFamily: tokens.font.mono,
  fontSize: tokens.font.size.sm,
  lineHeight: 1.6,
  background: tokens.color.bg,
  border: `1px solid ${tokens.color.border}`,
  borderRadius: tokens.radius.md,
  padding: tokens.space.md,
  overflowX: "auto",
  color: tokens.color.text,
  whiteSpace: "pre",
};

const linkStyle: CSS = {
  color: tokens.color.accentHover,
  textDecoration: "none",
  borderBottom: `1px solid ${tokens.color.accentBorder}`,
};

// ---------------------------------------------------------------------------
// Inline rendering
// ---------------------------------------------------------------------------

const INLINE_RE = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;

function renderInline(text: string, keyBase: string): React.ReactNode[] {
  const parts = text.split(INLINE_RE);
  const out: React.ReactNode[] = [];
  let k = 0;
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      out.push(
        <strong key={`${keyBase}-b${k++}`} style={{ fontWeight: tokens.font.weight.semibold, color: tokens.color.text }}>
          {part.slice(2, -2)}
        </strong>,
      );
    } else if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      out.push(
        <em key={`${keyBase}-i${k++}`} style={{ fontStyle: "italic", color: tokens.color.textMuted }}>
          {part.slice(1, -1)}
        </em>,
      );
    } else if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      out.push(<code key={`${keyBase}-c${k++}`} style={codeStyle}>{part.slice(1, -1)}</code>);
    } else if (part.startsWith("[") && part.includes("](")) {
      const close = part.indexOf("](");
      const end = part.indexOf(")", close);
      if (close > 0 && end > close) {
        const label = part.slice(1, close);
        const href = part.slice(close + 2, end);
        out.push(
          <a key={`${keyBase}-a${k++}`} href={href} target="_blank" rel="noopener noreferrer" style={linkStyle}>
            {label}
          </a>,
        );
      } else {
        out.push(part);
      }
    } else {
      out.push(part);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Block rendering
// ---------------------------------------------------------------------------

interface Block {
  type: "p" | "h1" | "h2" | "h3" | "ul" | "ol" | "code" | "quote" | "hr";
  lines: string[];
}

function parseBlocks(content: string): Block[] {
  const rawLines = content.split("\n");
  const blocks: Block[] = [];
  let i = 0;

  const push = (type: Block["type"], lines: string[]) => {
    if (lines.length > 0) blocks.push({ type, lines });
  };

  while (i < rawLines.length) {
    const line = rawLines[i];

    // Code fence
    if (line.trim().startsWith("```")) {
      const code: string[] = [];
      i++;
      while (i < rawLines.length && !rawLines[i].trim().startsWith("```")) {
        code.push(rawLines[i]);
        i++;
      }
      i++; // skip closing fence
      push("code", code);
      continue;
    }

    // Heading
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      push(h[1].length === 1 ? "h1" : h[1].length === 2 ? "h2" : "h3", [h[2]]);
      i++;
      continue;
    }

    // Horizontal rule
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      push("hr", []);
      i++;
      continue;
    }

    // Blockquote
    if (line.trim().startsWith(">")) {
      const quote: string[] = [];
      while (i < rawLines.length && rawLines[i].trim().startsWith(">")) {
        quote.push(rawLines[i].trim().replace(/^>\s?/, ""));
        i++;
      }
      push("quote", quote);
      continue;
    }

    // Unordered list
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < rawLines.length && /^\s*[-*+]\s+/.test(rawLines[i])) {
        items.push(rawLines[i].replace(/^\s*[-*+]\s+/, ""));
        i++;
      }
      push("ul", items);
      continue;
    }

    // Ordered list
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < rawLines.length && /^\s*\d+[.)]\s+/.test(rawLines[i])) {
        items.push(rawLines[i].replace(/^\s*\d+[.)]\s+/, ""));
        i++;
      }
      push("ol", items);
      continue;
    }

    // Blank line → paragraph break
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Paragraph (collect consecutive non-blank, non-special lines)
    const para: string[] = [];
    while (
      i < rawLines.length &&
      rawLines[i].trim() !== "" &&
      !rawLines[i].trim().startsWith("```") &&
      !/^\s*[-*+]\s+/.test(rawLines[i]) &&
      !/^\s*\d+[.)]\s+/.test(rawLines[i]) &&
      !/^(#{1,3})\s+/.test(rawLines[i]) &&
      !rawLines[i].trim().startsWith(">")
    ) {
      para.push(rawLines[i]);
      i++;
    }
    push("p", para);
  }

  return blocks;
}

export function Markdown({ content, style }: { content: string; style?: CSS }) {
  const blocks = parseBlocks(content);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: tokens.space.sm, ...style }}>
      {blocks.map((block, bi) => {
        const key = `blk-${bi}`;
        switch (block.type) {
          case "h1":
            return (
              <div key={key} style={{ fontSize: tokens.font.size.lg, fontWeight: tokens.font.weight.semibold, color: tokens.color.text, lineHeight: 1.3 }}>
                {renderInline(block.lines[0] ?? "", key)}
              </div>
            );
          case "h2":
            return (
              <div key={key} style={{ fontSize: tokens.font.size.md, fontWeight: tokens.font.weight.semibold, color: tokens.color.text, lineHeight: 1.3 }}>
                {renderInline(block.lines[0] ?? "", key)}
              </div>
            );
          case "h3":
            return (
              <div key={key} style={{ fontSize: tokens.font.size.sm, fontWeight: tokens.font.weight.semibold, color: tokens.color.textMuted, lineHeight: 1.3 }}>
                {renderInline(block.lines[0] ?? "", key)}
              </div>
            );
          case "p":
            return (
              <div key={key} style={{ lineHeight: tokens.font.leading.relaxed, color: tokens.color.text }}>
                {block.lines.map((l, li) => (
                  <React.Fragment key={`${key}-${li}`}>
                    {li > 0 ? <br /> : null}
                    {renderInline(l, `${key}-${li}`)}
                  </React.Fragment>
                ))}
              </div>
            );
          case "ul":
            return (
              <ul key={key} style={{ margin: 0, paddingLeft: tokens.space.xl, display: "flex", flexDirection: "column", gap: tokens.space.xs }}>
                {block.lines.map((item, li) => (
                  <li key={`${key}-${li}`} style={{ lineHeight: tokens.font.leading.relaxed, color: tokens.color.text }}>
                    {renderInline(item, `${key}-${li}`)}
                  </li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={key} style={{ margin: 0, paddingLeft: tokens.space.xl, display: "flex", flexDirection: "column", gap: tokens.space.xs }}>
                {block.lines.map((item, li) => (
                  <li key={`${key}-${li}`} style={{ lineHeight: tokens.font.leading.relaxed, color: tokens.color.text }}>
                    {renderInline(item, `${key}-${li}`)}
                  </li>
                ))}
              </ol>
            );
          case "code":
            return (
              <pre key={key} style={preStyle}>
                {block.lines.join("\n")}
              </pre>
            );
          case "quote":
            return (
              <div
                key={key}
                style={{
                  borderLeft: `2px solid ${tokens.color.accentBorder}`,
                  paddingLeft: tokens.space.md,
                  color: tokens.color.textMuted,
                  fontStyle: "italic",
                  display: "flex",
                  flexDirection: "column",
                  gap: tokens.space.xs,
                }}
              >
                {block.lines.map((l, li) => (
                  <div key={`${key}-${li}`}>{renderInline(l, `${key}-${li}`)}</div>
                ))}
              </div>
            );
          case "hr":
            return <div key={key} style={{ height: 1, background: tokens.color.border, margin: `${tokens.space.xs} 0` }} />;
        }
      })}
    </div>
  );
}
