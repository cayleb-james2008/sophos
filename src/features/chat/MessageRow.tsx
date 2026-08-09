// MessageRow — renders a single transcript message, role-aware.
//   * user      — right-aligned accent bubble
//   * assistant — full-width row with a SOPHOS avatar chip, thinking + tool calls
//   * system    — centered dim pill
//   * tool      — nested tool card
// Streaming assistant messages get a blinking caret.

import { useState } from "react";
import { tokens } from "../../design/tokens";
import { Text } from "../../design";
import type { TranscriptMessage } from "../../ipc/contract";
import { Markdown } from "./markdown";
import { ThinkingBlock } from "./ThinkingBlock";
import { ToolCallCard } from "./ToolCallCard";

// SophosMark — the geometric "Σ" (sigma, sum of knowledge) wordmark in Geist
// Mono, replacing the old Prime bolt glyph.
function SophosMark({ size = 12, color }: { size?: number; color: string }) {
  return (
    <span
      style={{
        fontFamily: tokens.font.mono,
        fontSize: size,
        lineHeight: 1,
        fontWeight: tokens.font.weight.semibold,
        color,
      }}
    >
      Σ
    </span>
  );
}

function formatTime(ts?: string): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function StreamingCaret() {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: 7,
        height: 15,
        marginLeft: 2,
        verticalAlign: "text-bottom",
        background: tokens.color.accentHover,
        borderRadius: 0,
        animation: "pa-blink 0.9s step-end infinite",
      }}
    />
  );
}

// CopyButton — a small icon button that appears on hover and copies text to
// the clipboard, showing a brief checkmark on success.
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

export function MessageRow({ message }: { message: TranscriptMessage }) {
  const time = formatTime(message.timestamp);

  // ---- System ----
  if (message.role === "system") {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: `${tokens.space.sm} 0` }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: tokens.space.sm,
            padding: "4px 12px",
            borderRadius: tokens.radius.sm,
            background: tokens.color.bgElevated,
            border: `1px solid ${tokens.color.border}`,
          }}
        >
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: tokens.color.textDim }} />
          <Text variant="micro" tone="dim" mono>
            {message.content}
          </Text>
        </div>
      </div>
    );
  }

  // ---- Tool (standalone) ----
  if (message.role === "tool") {
    return (
      <div style={{ padding: `${tokens.space.xs} 0 ${tokens.space.xs} ${tokens.space["2xl"]}` }}>
        <ToolCallCard
          call={{
            id: message.id,
            name: "tool",
            input: message.content,
            output: undefined,
            status: message.status === "error" ? "error" : "complete",
          }}
        />
      </div>
    );
  }

  // ---- User ----
  if (message.role === "user") {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: tokens.space.xs }}>
        <div style={{ display: "flex", alignItems: "center", gap: tokens.space.sm }}>
          <Text variant="micro" tone="dim" mono uppercase>
            You
          </Text>
          {time ? (
            <Text variant="micro" tone="dim" mono>
              {time}
            </Text>
          ) : null}
        </div>
        <div
          style={{
            maxWidth: "78%",
            padding: `${tokens.space.md} ${tokens.space.lg}`,
            borderRadius: tokens.radius.lg,
            borderTopRightRadius: tokens.radius.sm,
            background: tokens.color.surface,
            border: `1px solid ${tokens.color.border}`,
            color: tokens.color.user,
            fontSize: tokens.font.size.md,
            lineHeight: tokens.font.leading.relaxed,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {message.content}
        </div>
      </div>
    );
  }

  // ---- Assistant ----
  const hasThinking = !!message.thinking && message.thinking.trim().length > 0;
  const hasToolCalls = !!message.toolCalls && message.toolCalls.length > 0;
  const isStreaming = message.status === "streaming";
  const isError = message.status === "error";

  return (
    <div style={{ display: "flex", gap: tokens.space.md, padding: `${tokens.space.sm} 0` }}>
      {/* Avatar chip */}
      <div
        style={{
          flexShrink: 0,
          width: 30,
          height: 30,
          borderRadius: tokens.radius.md,
          background: tokens.color.accent,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginTop: 2,
        }}
      >
        <SophosMark color={tokens.color.textInverse} />
      </div>

      {/* Body */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: tokens.space.sm }}>
        <div style={{ display: "flex", alignItems: "center", gap: tokens.space.sm }}>
          <Text variant="micro" tone="muted" mono uppercase>
            Sophos
          </Text>
          {time ? (
            <Text variant="micro" tone="dim" mono>
              {time}
            </Text>
          ) : null}
          {isError ? (
            <Text variant="micro" tone="danger" mono uppercase>
              error
            </Text>
          ) : null}
        </div>

        {hasThinking ? <ThinkingBlock thinking={message.thinking ?? ""} streaming={isStreaming} /> : null}

        {hasToolCalls ? (
          <div style={{ display: "flex", flexDirection: "column", gap: tokens.space.sm }}>
            {message.toolCalls!.map((tc) => (
              <ToolCallCard key={tc.id} call={tc} />
            ))}
          </div>
        ) : null}

        {message.content ? (
          <div
            style={{
              color: isError ? tokens.color.danger : tokens.color.assistant,
              fontSize: tokens.font.size.md,
              lineHeight: tokens.font.leading.relaxed,
              wordBreak: "break-word",
            }}
          >
            <Markdown content={message.content} />
            {isStreaming ? <StreamingCaret /> : null}
          </div>
        ) : isStreaming ? (
          <div style={{ display: "flex", alignItems: "center", gap: tokens.space.sm, padding: `${tokens.space.xs} 0` }}>
            <span style={{ display: "inline-flex", gap: 4 }}>
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: "50%",
                    background: tokens.color.accentHover,
                    animation: `pa-blink 1.1s ease-in-out ${i * 0.18}s infinite`,
                  }}
                />
              ))}
            </span>
            <Text variant="label" tone="muted">
              Working…
            </Text>
          </div>
        ) : null}

        {/* Copy-on-hover for assistant content */}
        {message.content && !isStreaming ? (
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: -2 }}>
            <CopyButton text={message.content} label="Copy assistant message" />
          </div>
        ) : null}
      </div>
    </div>
  );
}
