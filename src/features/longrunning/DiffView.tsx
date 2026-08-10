// DiffView — renders a unified diff (added / removed / context lines) in the
// Sophos visual language: terminal-green additions, red removals, monospace,
// hairline rules, zero radius. Shared by the RefinementGateBanner and the
// RefinementHistory panel.

import { tokens } from "../../design/tokens";
import type { DiffLine } from "./diff";

const lineStyle: React.CSSProperties = {
  display: "flex",
  gap: tokens.space.sm,
  padding: "1px 8px",
  fontFamily: tokens.font.mono,
  fontSize: tokens.font.size.xs,
  lineHeight: 1.5,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};

export function DiffView({ lines }: { lines: DiffLine[] }) {
  return (
    <div
      style={{
        background: tokens.color.bg,
        border: `1px solid ${tokens.color.border}`,
        borderRadius: tokens.radius.md,
        overflow: "auto",
        maxHeight: 240,
      }}
    >
      {lines.map((l, i) => {
        const marker = l.type === "add" ? "+" : l.type === "del" ? "-" : " ";
        const bg =
          l.type === "add"
            ? "rgba(133,237,117,0.10)"
            : l.type === "del"
              ? "rgba(239,68,68,0.10)"
              : "transparent";
        const color =
          l.type === "add"
            ? tokens.color.success
            : l.type === "del"
              ? tokens.color.danger
              : tokens.color.textDim;
        return (
          <div key={i} style={{ ...lineStyle, background: bg, color }}>
            <span
              style={{
                width: 12,
                flexShrink: 0,
                userSelect: "none",
                color: tokens.color.textDim,
              }}
            >
              {marker}
            </span>
            <span>{l.text || " "}</span>
          </div>
        );
      })}
    </div>
  );
}

export default DiffView;
