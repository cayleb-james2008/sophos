// MessageRow — renders a single transcript message, role-aware.
//   * user      — right-aligned accent bubble
//   * assistant — full-width row with a SOPHOS avatar chip, thinking + tool calls
//   * system    — centered dim pill
//   * tool      — nested tool card
// Streaming assistant messages get a blinking caret.

import { tokens } from "../../design/tokens";
import { Text } from "../../design";
import type { TranscriptMessage } from "../../ipc/contract";
import { Markdown } from "./markdown";
import { ThinkingBlock } from "./ThinkingBlock";
import { ToolCallCard } from "./ToolCallCard";
import { MessageActions } from "./MessageActions";

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
  return <span aria-hidden className="message-row__streaming-caret" />;
}

export function MessageRow({
  message,
  canRetry,
  canEdit,
  onRetry,
  onEdit,
}: {
  message: TranscriptMessage;
  canRetry: boolean;
  canEdit: boolean;
  onRetry: (message: TranscriptMessage) => void;
  onEdit: (message: TranscriptMessage) => void;
}) {
  const time = formatTime(message.timestamp);

  // ---- System ----
  if (message.role === "system") {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: tokens.space.xs, padding: `${tokens.space.sm} 0` }}>
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
        <MessageActions role="system" content={message.content} />
      </div>
    );
  }

  // ---- Tool (standalone) ----
  if (message.role === "tool") {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: tokens.space.xs, padding: `${tokens.space.xs} 0 ${tokens.space.xs} ${tokens.space["2xl"]}` }}>
        <ToolCallCard
          call={{
            id: message.id,
            name: "tool",
            input: message.content,
            output: undefined,
            status: message.status === "error" ? "error" : "complete",
          }}
        />
        <MessageActions role="tool" content={message.content} />
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
        <MessageActions role="user" content={message.content} onEdit={() => onEdit(message)} canEdit={canEdit} />
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
      {/* Avatar chip — a brand mark, not a status signal, so it must not be the
          loudest accent object on the page (vision-critic D9). A solid green
          fill made it exactly that. Soft accent wash + hairline accent border +
          full-opacity glyph keeps the identity while returning green to its job
          as a signal for live/active state. */}
      <div
        style={{
          flexShrink: 0,
          width: 30,
          height: 30,
          borderRadius: tokens.radius.md,
          background: tokens.color.accentSoft,
          border: `1px solid ${tokens.color.accentBorder}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginTop: 2,
          boxSizing: "border-box",
        }}
      >
        <SophosMark color={tokens.color.accentHover} />
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
            className={`message-row__content${isStreaming ? " message-row__content--streaming" : ""}`}
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
                <span key={i} className="message-row__working-dot" />
              ))}
            </span>
            <Text variant="label" tone="muted">
              Working…
            </Text>
          </div>
        ) : null}

        {/* Copy + retry on hover for assistant content */}
        {message.content && !isStreaming ? (
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: -2 }}>
            <MessageActions
              role="assistant"
              content={message.content}
              onRetry={() => onRetry(message)}
              canRetry={canRetry}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
