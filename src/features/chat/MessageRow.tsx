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
    <span className="msg-avatar-glyph" style={{ fontSize: size, color }}>
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
      <div className="msg-row--system">
        <div className="msg-system-pill">
          <span className="msg-system-dot" />
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
      <div className="msg-row--tool">
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
      <div className="msg-row--user">
        <div className="msg-user-head">
          <Text variant="micro" tone="dim" mono uppercase>
            You
          </Text>
          {time ? (
            <Text variant="micro" tone="dim" mono>
              {time}
            </Text>
          ) : null}
        </div>
        <div className="msg-user-bubble">
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
    <div className="msg-row">
      {/* Avatar chip — a brand mark, not a status signal, so it must not be the
          loudest accent object on the page (vision-critic D9). A solid green
          fill made it exactly that. Soft accent wash + hairline accent border +
          full-opacity glyph keeps the identity while returning green to its job
          as a signal for live/active state. */}
      <div className="msg-avatar">
        <SophosMark color={tokens.color.accentHover} />
      </div>

      {/* Body */}
      <div className="msg-body">
        <div className="msg-head">
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
          <div className="msg-toolcalls">
            {message.toolCalls!.map((tc) => (
              <ToolCallCard key={tc.id} call={tc} />
            ))}
          </div>
        ) : null}

        {message.content ? (
          <div
            className={`msg-content${isStreaming ? " message-row__content--streaming" : ""}${isError ? " msg-content--error" : ""}`}
          >
            <Markdown content={message.content} />
            {isStreaming ? <StreamingCaret /> : null}
          </div>
        ) : isStreaming ? (
          <div className="msg-working">
            <span className="msg-working-dots">
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
          <div className="msg-actions-wrap">
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
