// ThinkingBlock — a collapsible reasoning block for assistant messages.
// Collapsed: a slim "THINKING" header with a status. Expanded: the reasoning
// text with a subtle left accent. Animated open/close.

import { useState } from "react";
import { tokens } from "../../design/tokens";
import { Text } from "../../design";

function ThinkingIcon({ size = 13, color }: { size?: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3a4 4 0 0 0-4 4c0 1.2.5 2.2 1.3 3A4 4 0 0 0 8 13a4 4 0 0 0 8 0 4 4 0 0 0-1.3-3A4 4 0 0 0 16 7a4 4 0 0 0-4-4z" />
      <path d="M9 18h6M10 21h4" />
    </svg>
  );
}

export function ThinkingBlock({
  thinking,
  streaming = false,
  defaultOpen = false,
}: {
  thinking: string;
  streaming?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const hasContent = thinking.trim().length > 0;

  return (
    <div
      style={{
        border: `1px solid ${tokens.color.border}`,
        borderRadius: tokens.radius.md,
        background: tokens.color.bgElevated,
        overflow: "hidden",
        transition: `border-color ${tokens.motion.fast} ${tokens.motion.ease}`,
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="pa-focus-ring"
        style={{
          display: "flex",
          alignItems: "center",
          gap: tokens.space.sm,
          width: "100%",
          padding: "7px 12px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          color: tokens.color.textMuted,
          fontFamily: tokens.font.sans,
          fontSize: tokens.font.size.xs,
          textAlign: "left",
        }}
      >
        <ThinkingIcon color={tokens.color.accentHover} />
        <Text variant="micro" tone="muted" mono uppercase>
          Thinking
        </Text>
        {streaming ? (
          <span style={{ display: "inline-flex", gap: 3, marginLeft: 2 }}>
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                style={{
                  width: 3,
                  height: 3,
                  borderRadius: "50%",
                  background: tokens.color.accentHover,
                  animation: `pa-blink 1.2s ease-in-out ${i * 0.2}s infinite`,
                }}
              />
            ))}
          </span>
        ) : (
          <Text variant="micro" tone="dim" style={{ marginLeft: 2 }}>
            {hasContent ? `${thinking.split(/\s+/).length} tokens` : "empty"}
          </Text>
        )}
        <span style={{ marginLeft: "auto", display: "inline-flex", color: tokens.color.textDim }}>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ transform: open ? "rotate(180deg)" : undefined, transition: `transform ${tokens.motion.base} ${tokens.motion.ease}` }}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>

      {open ? (
        <div
          style={{
            padding: `${tokens.space.xs} ${tokens.space.md} ${tokens.space.md}`,
            borderTop: `1px solid ${tokens.color.border}`,
            animation: "pa-slide-down 160ms cubic-bezier(0.16,1,0.3,1)",
          }}
        >
          <div
            style={{
              borderLeft: `2px solid ${tokens.color.accentBorder}`,
              paddingLeft: tokens.space.md,
              color: tokens.color.textDim,
              fontFamily: tokens.font.sans,
              fontSize: tokens.font.size.sm,
              lineHeight: tokens.font.leading.relaxed,
              whiteSpace: "pre-wrap",
            }}
          >
            {hasContent ? thinking : "Reasoning in progress…"}
          </div>
        </div>
      ) : null}
    </div>
  );
}
