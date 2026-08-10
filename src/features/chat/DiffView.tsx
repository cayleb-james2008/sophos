// DiffView — renders a unified line diff for a file-edit tool call.
//
// Added lines get a terminal-green tint, removed lines a red tint, context
// lines stay dim. Monospace (Geist Mono), sharp corners, hairline borders —
// matching the Sophos design DNA. A header shows the file path with "Copy
// diff" and "Copy path" affordances (same CopyButton pattern as MessageRow).

import { useState } from "react";
import { tokens } from "../../design/tokens";
import { Text } from "../../design";
import type { DiffLine } from "./diff";

// CopyButton — a small icon button that copies text to the clipboard, showing
// a brief checkmark on success. Mirrors the pattern in MessageRow.tsx.
function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const [visible, setVisible] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for restricted contexts.
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {
        /* ignore */
      }
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <button
      type="button"
      aria-label={label}
      title={copied ? "Copied" : "Copy"}
      onClick={copy}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      className="pa-focus-ring"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 24,
        height: 24,
        borderRadius: tokens.radius.sm,
        background: copied ? tokens.color.accentSoft : tokens.color.bgOverlay,
        border: `1px solid ${copied ? tokens.color.accentBorder : tokens.color.border}`,
        color: copied ? tokens.color.accentHover : tokens.color.textDim,
        cursor: "pointer",
        opacity: visible || copied ? 1 : 0,
        transform: visible || copied ? "translateY(0)" : "translateY(-2px)",
        transition: `opacity ${tokens.motion.fast} ${tokens.motion.ease}, transform ${tokens.motion.fast} ${tokens.motion.ease}, background ${tokens.motion.fast} ${tokens.motion.ease}`,
      }}
    >
      {copied ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}

export function DiffView({
  filePath,
  lines,
  unified,
}: {
  filePath: string;
  lines: DiffLine[];
  unified: string;
}) {
  const addCount = lines.filter((l) => l.type === "add").length;
  const removeCount = lines.filter((l) => l.type === "remove").length;

  return (
    <div
      data-diff="true"
      style={{
        border: `1px solid ${tokens.color.border}`,
        background: tokens.color.bg,
        overflow: "hidden",
      }}
    >
      {/* Header — file path + add/remove counts + copy affordances */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: tokens.space.sm,
          padding: "6px 10px",
          borderBottom: `1px solid ${tokens.color.border}`,
          background: tokens.color.bgElevated,
        }}
      >
        <span
          style={{
            fontFamily: tokens.font.mono,
            fontSize: tokens.font.size.xs,
            color: tokens.color.accent,
            userSelect: "none",
          }}
        >
          Δ
        </span>
        <Text
          variant="micro"
          tone="muted"
          mono
          style={{
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {filePath || "(unknown path)"}
        </Text>
        <Text variant="micro" tone="success" mono>
          +{addCount}
        </Text>
        <Text variant="micro" tone="danger" mono>
          −{removeCount}
        </Text>
        <CopyButton text={unified} label="Copy diff" />
        <CopyButton text={filePath} label="Copy path" />
      </div>

      {/* Lines — green added, red removed, dim context */}
      <div
        style={{
          maxHeight: 260,
          overflowY: "auto",
          fontFamily: tokens.font.mono,
          fontSize: tokens.font.size.xs,
          lineHeight: 1.6,
        }}
      >
        {lines.map((l, i) => {
          const isAdd = l.type === "add";
          const isRemove = l.type === "remove";
          const bg = isAdd
            ? tokens.color.accentSoft
            : isRemove
              ? tokens.color.dangerSoft
              : "transparent";
          const color = isAdd
            ? tokens.color.accentHover
            : isRemove
              ? tokens.color.danger
              : tokens.color.textDim;
          const sign = isAdd ? "+" : isRemove ? "-" : " ";
          return (
            <div
              key={i}
              data-diff-add={isAdd ? "true" : undefined}
              data-diff-remove={isRemove ? "true" : undefined}
              style={{ display: "flex", background: bg }}
            >
              <span
                style={{
                  width: 22,
                  flexShrink: 0,
                  textAlign: "right",
                  paddingRight: 6,
                  color: tokens.color.textDim,
                  userSelect: "none",
                  opacity: 0.5,
                }}
              >
                {sign}
              </span>
              <span
                style={{
                  color,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  flex: 1,
                }}
              >
                {l.text || " "}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
