// ThinkingBlock — a collapsible reasoning block for assistant messages.
// Collapsed: a slim "THINKING" header with a status. Expanded: the reasoning
// text with a subtle left accent. Animated open/close.

import { useState } from "react";
import { tokens } from "../../design/tokens";
import { Text, Button } from "../../design";

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
    <div className="thinking">
      <Button
        variant="ghost"
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="thinking-toggle"
      >
        <ThinkingIcon color={tokens.color.info} />
        <Text variant="micro" tone="muted" mono uppercase>
          Thinking
        </Text>
        {streaming ? (
          <span className="thinking-dots">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="thinking-dot"
                style={{ animationDelay: `${i * 0.2}s` }}
              />
            ))}
          </span>
        ) : (
          <Text variant="micro" tone="dim" className="thinking-meta">
            {hasContent ? `${thinking.split(/\s+/).length} tokens` : "empty"}
          </Text>
        )}
        <span className="thinking-chevron">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`thinking-chevron-ico${open ? " is-open" : ""}`}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </Button>

      {open ? (
        <div className="thinking-body">
          <div className="thinking-text">
            {hasContent ? thinking : "Reasoning in progress…"}
          </div>
        </div>
      ) : null}
    </div>
  );
}
