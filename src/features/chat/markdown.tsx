// markdown — a lightweight, dependency-free markdown renderer for chat content.
// Handles the common chat subset: paragraphs, headings, lists, code blocks,
// inline code, bold, italic, links, blockquotes, and horizontal rules.
// Renders to React elements (no dangerouslySetInnerHTML) so it is XSS-safe.

import React from "react";

type CSS = React.CSSProperties;

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
        <strong key={`${keyBase}-b${k++}`} className="md-strong">
          {part.slice(2, -2)}
        </strong>,
      );
    } else if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      out.push(
        <em key={`${keyBase}-i${k++}`} className="md-em">
          {part.slice(1, -1)}
        </em>,
      );
    } else if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      out.push(<code key={`${keyBase}-c${k++}`} className="md-code">{part.slice(1, -1)}</code>);
    } else if (part.startsWith("[") && part.includes("](")) {
      const close = part.indexOf("](");
      const end = part.indexOf(")", close);
      if (close > 0 && end > close) {
        const label = part.slice(1, close);
        const href = part.slice(close + 2, end);
        out.push(
          <a key={`${keyBase}-a${k++}`} href={href} target="_blank" rel="noopener noreferrer" className="md-link">
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
    <div className="md-root" style={style}>
      {blocks.map((block, bi) => {
        const key = `blk-${bi}`;
        switch (block.type) {
          case "h1":
            return (
              <div key={key} className="md-h1">
                {renderInline(block.lines[0] ?? "", key)}
              </div>
            );
          case "h2":
            return (
              <div key={key} className="md-h2">
                {renderInline(block.lines[0] ?? "", key)}
              </div>
            );
          case "h3":
            return (
              <div key={key} className="md-h3">
                {renderInline(block.lines[0] ?? "", key)}
              </div>
            );
          case "p":
            return (
              <div key={key} className="md-p">
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
              <ul key={key} className="md-ul">
                {block.lines.map((item, li) => (
                  <li key={`${key}-${li}`} className="md-li">
                    {renderInline(item, `${key}-${li}`)}
                  </li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={key} className="md-ol">
                {block.lines.map((item, li) => (
                  <li key={`${key}-${li}`} className="md-li">
                    {renderInline(item, `${key}-${li}`)}
                  </li>
                ))}
              </ol>
            );
          case "code":
            return (
              <pre key={key} className="md-pre">
                {block.lines.join("\n")}
              </pre>
            );
          case "quote":
            return (
              <div key={key} className="md-quote">
                {block.lines.map((l, li) => (
                  <div key={`${key}-${li}`}>{renderInline(l, `${key}-${li}`)}</div>
                ))}
              </div>
            );
          case "hr":
            return <div key={key} className="md-hr" />;
        }
      })}
    </div>
  );
}
