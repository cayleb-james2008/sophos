// Composer — the prompt input. Auto-growing multi-line textarea with the full
// TUI-parity interaction set:
//   * Enter            → send when idle, steer when busy
//   * Alt+Enter        → queue a follow-up (delivered after all work)
//   * Escape           → clear text (idle) / clear queued follow-ups (busy)
//   * Alt+Up           → retrieve the last queued follow-up into the editor
//   * `@`              → file-reference hint popover
//   * `!cmd` / `!!cmd` → shell command (visible / hidden)
//   * `/btw` / `/side` → inline side question
// Includes an abort control while streaming, pending follow-up chips below the
// input, inline side-question panels, and transient steer/shell indicators.

import React, { useEffect, useRef, useState } from "react";
import { tokens } from "../../design/tokens";
import { Text, Kbd, StatusDot } from "../../design";
import type { FollowUp, SideQuestion, SideQuestionStatus } from "./useChat";

function SendIcon({ size = 15, color }: { size?: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

function StopIcon({ size = 14, color }: { size?: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round">
      <rect x="6" y="6" width="12" height="12" rx="2" fill={color} stroke="none" />
    </svg>
  );
}

function XSmall({ size = 11, color }: { size?: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

function ChevronIcon({ open, color }: { open: boolean; color: string }) {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transition: "transform 120ms ease", transform: open ? "rotate(90deg)" : "none" }}>
      <polyline points="9 6 15 12 9 18" />
    </svg>
  );
}

const sideStatusMeta: Record<SideQuestionStatus, { tone: "success" | "warning" | "danger" | "info"; label: string; dot: "connected" | "connecting" | "disconnected" | "idle" }> = {
  running: { tone: "info", label: "running", dot: "connecting" },
  complete: { tone: "success", label: "complete", dot: "connected" },
  cancelled: { tone: "warning", label: "cancelled", dot: "idle" },
  error: { tone: "danger", label: "error", dot: "disconnected" },
};

// ---- Side question inline panel ----------------------------------------

function SideQuestionPanel({
  sq,
  onDismiss,
}: {
  sq: SideQuestion;
  onDismiss: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const meta = sideStatusMeta[sq.status];
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: tokens.space.sm,
        background: tokens.color.bgElevated,
        border: `1px solid ${tokens.color.borderStrong}`,
        borderLeft: `2px solid ${tokens.color.accent}`,
        borderRadius: tokens.radius.md,
        padding: `${tokens.space.sm} ${tokens.space.md}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: tokens.space.sm }}>
        <StatusDot state={meta.dot} size={6} pulse={sq.status === "running"} />
        <Text variant="micro" tone="accent" mono uppercase style={{ letterSpacing: "0.1em" }}>
          /{sq.kind}
        </Text>
        <Text variant="micro" tone="muted" mono uppercase>
          {meta.label}
        </Text>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          title={open ? "Hide reply" : "Show reply"}
          aria-label={open ? "Hide reply" : "Show reply"}
          className="pa-focus-ring"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            background: "transparent",
            border: "none",
            color: tokens.color.textDim,
            cursor: "pointer",
            fontFamily: tokens.font.sans,
            fontSize: tokens.font.size.xs,
            padding: "2px 4px",
            borderRadius: tokens.radius.sm,
          }}
        >
          <Text variant="micro" tone="dim">
            reply
          </Text>
          <ChevronIcon open={open} color={tokens.color.textDim} />
        </button>
        <button
          type="button"
          onClick={() => onDismiss(sq.id)}
          title="Dismiss side question"
          aria-label="Dismiss side question"
          className="pa-focus-ring"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background: "transparent",
            border: "none",
            color: tokens.color.textDim,
            cursor: "pointer",
            padding: 2,
            borderRadius: tokens.radius.sm,
          }}
        >
          <XSmall color={tokens.color.textDim} />
        </button>
      </div>
      <Text variant="body" tone="default" style={{ whiteSpace: "pre-wrap" }}>
        {sq.question}
      </Text>
      {open ? (
        <div
          style={{
            borderTop: `1px solid ${tokens.color.border}`,
            paddingTop: tokens.space.sm,
            color: tokens.color.textMuted,
            fontSize: tokens.font.size.sm,
            lineHeight: tokens.font.leading.normal,
            whiteSpace: "pre-wrap",
          }}
        >
          {sq.answer || (sq.status === "running" ? "Thinking…" : `No reply recorded (${sq.status}).`)}
        </div>
      ) : null}
    </div>
  );
}

// ---- Composer ------------------------------------------------------------

export function Composer({
  busy,
  onSend,
  onAbort,
  onSteer,
  onQueueFollowUp,
  onClearFollowUps,
  onPopFollowUp,
  followUps,
  steered,
  shellNotice,
  onSideQuestion,
  sideQuestions,
  onDismissSideQuestion,
  onShell,
  onSetName,
}: {
  busy: boolean;
  onSend: (text: string) => void;
  onAbort: () => void;
  onSteer: (text: string) => void;
  onQueueFollowUp: (text: string) => void;
  onClearFollowUps: () => void;
  onPopFollowUp: () => string | undefined;
  followUps: FollowUp[];
  steered: { text: string; at: number } | null;
  shellNotice: { command: string; hidden: boolean } | null;
  onSideQuestion: (kind: "btw" | "side", question: string) => void;
  sideQuestions: SideQuestion[];
  onDismissSideQuestion: (id: string) => void;
  onShell: (command: string, hidden: boolean) => void;
  onSetName: (name: string) => void;
}) {
  const [value, setValue] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);
  const canSend = value.trim().length > 0 && !busy;

  // Auto-grow the textarea.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  const focusInput = () => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.focus();
  };

  const clearInput = () => {
    setValue("");
    focusInput();
  };

  // Route a submitted line to the correct handler based on prefix + busy.
  const submit = () => {
    const raw = value;
    const trimmed = raw.trim();

    // Inline side question.
    if (raw.startsWith("/btw ") || raw.startsWith("/side ")) {
      const kind: "btw" | "side" = raw.startsWith("/btw ") ? "btw" : "side";
      const q = (kind === "btw" ? raw.slice(5) : raw.slice(6)).trim();
      if (q) {
        onSideQuestion(kind, q);
        clearInput();
      }
      return;
    }

    // Shell command (!cmd visible, !!cmd hidden).
    if (raw.startsWith("!!")) {
      const cmd = raw.slice(2).trim();
      if (cmd) {
        onShell(cmd, true);
        clearInput();
      }
      return;
    }
    if (raw.startsWith("!")) {
      const cmd = raw.slice(1).trim();
      if (cmd) {
        onShell(cmd, false);
        clearInput();
      }
      return;
    }

    // Set session display name (/name <name>). Routed like /btw//side so it
    // works whether or not the agent is busy.
    if (raw.startsWith("/name ")) {
      const name = raw.slice(6).trim();
      if (name) {
        onSetName(name);
        clearInput();
      }
      return;
    }

    if (!trimmed) return;
    if (busy) {
      // Steering — delivered after the current tool calls complete.
      onSteer(trimmed);
      clearInput();
      return;
    }
    onSend(trimmed);
    clearInput();
  };


  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Escape clears text (idle) or queued follow-ups (busy).
    if (e.key === "Escape") {
      if (busy) {
        onClearFollowUps();
        e.preventDefault();
        return;
      }
      setValue("");
      e.preventDefault();
      return;
    }
    // Alt+Up retrieves the last queued follow-up back into the editor.
    if (e.key === "ArrowUp" && e.altKey) {
      e.preventDefault();
      const popped = onPopFollowUp();
      if (popped !== undefined) setValue(popped);
      focusInput();
      return;
    }
    // Alt+Enter queues a follow-up.
    if (e.key === "Enter" && e.altKey) {
      e.preventDefault();
      const t = value.trim();
      if (t) {
        onQueueFollowUp(t);
        setValue("");
        focusInput();
      }
      return;
    }
    // Enter sends (idle) or steers (busy); Shift+Enter is a newline.
    if (e.key === "Enter" && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      submit();
    }
  };

  const fileHintVisible = value.includes("@");

  return (
    <div
      style={{
        flexShrink: 0,
        padding: `${tokens.space.md} ${tokens.space.xl} ${tokens.space.xl}`,
        background: `linear-gradient(180deg, transparent, ${tokens.color.bg} 40%)`,
      }}
    >
      <div
        style={{
          maxWidth: tokens.layout.maxContentW,
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          gap: tokens.space.sm,
        }}
      >
        {/* Inline side questions */}
        {sideQuestions.map((sq) => (
          <SideQuestionPanel key={sq.id} sq={sq} onDismiss={onDismissSideQuestion} />
        ))}

        {/* Steered / shell transient indicators */}
        {steered ? (
          <div style={{ display: "flex", alignItems: "center", gap: tokens.space.sm }}>
            <StatusDot state="connected" size={6} />
            <Text variant="micro" tone="accent" mono uppercase>
              steered
            </Text>
            <Text variant="micro" tone="muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              “{steered.text}”
            </Text>
          </div>
        ) : null}
        {shellNotice ? (
          <div style={{ display: "flex", alignItems: "center", gap: tokens.space.sm }}>
            <StatusDot state={shellNotice.hidden ? "idle" : "connected"} size={6} />
            <Text variant="micro" tone={shellNotice.hidden ? "dim" : "info"} mono uppercase>
              {shellNotice.hidden ? "hidden shell" : "shell"}
            </Text>
            <Text variant="micro" tone="muted" mono style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              $ {shellNotice.command}
            </Text>
          </div>
        ) : null}

        {/* Input box */}
        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "flex-end",
            gap: tokens.space.sm,
            background: tokens.color.bgElevated,
            border: `1px solid ${tokens.color.borderStrong}`,
            borderRadius: tokens.radius.lg,
            padding: `${tokens.space.sm} ${tokens.space.sm} ${tokens.space.sm} ${tokens.space.lg}`,
            boxShadow: tokens.shadow.md,
            transition: `border-color ${tokens.motion.fast} ${tokens.motion.ease}, box-shadow ${tokens.motion.fast} ${tokens.motion.ease}`,
          }}
          onFocusCapture={(e) => {
            const el = e.currentTarget;
            el.style.borderColor = tokens.color.accentBorder;
            el.style.boxShadow = tokens.shadow.glow;
          }}
          onBlurCapture={(e) => {
            const el = e.currentTarget;
            el.style.borderColor = tokens.color.borderStrong;
            el.style.boxShadow = tokens.shadow.md;
          }}
        >
          {/* File reference hint popover */}
          {fileHintVisible ? (
            <div
              style={{
                position: "absolute",
                left: tokens.space.sm,
                bottom: "calc(100% + 8px)",
                display: "flex",
                alignItems: "center",
                gap: tokens.space.sm,
                padding: "6px 12px",
                background: tokens.color.bgOverlay,
                border: `1px solid ${tokens.color.borderStrong}`,
                borderRadius: tokens.radius.md,
                boxShadow: tokens.shadow.lg,
              }}
            >
              <Text variant="micro" tone="accent" mono>
                @
              </Text>
              <Text variant="micro" tone="muted">
                reference a project file
              </Text>
            </div>
          ) : null}

          <textarea
            ref={taRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={
              busy
                ? "Working… type to steer (Enter), queue a follow-up (Alt+Enter)"
                : "Message Sophos…  (@ file · ! shell · /btw side question)"
            }
            rows={1}
            aria-label="Message input"
            className="pa-focus-ring"
            style={{
              flex: 1,
              minHeight: 24,
              maxHeight: 200,
              background: "transparent",
              border: "none",
              outline: "none",
              resize: "none",
              color: tokens.color.text,
              fontFamily: tokens.font.sans,
              fontSize: tokens.font.size.md,
              lineHeight: tokens.font.leading.normal,
              padding: "6px 0",
              overflowY: "auto",
            }}
          />

          {busy ? (
            <button
              type="button"
              onClick={onAbort}
              title="Stop generating"
              aria-label="Stop generating"
              className="pa-focus-ring"
              style={{
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 34,
                height: 34,
                borderRadius: tokens.radius.md,
                background: tokens.color.danger + "24",
                border: `1px solid ${tokens.color.danger}55`,
                color: tokens.color.danger,
                cursor: "pointer",
                transition: `all ${tokens.motion.fast} ${tokens.motion.ease}`,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = tokens.color.danger + "3d";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = tokens.color.danger + "24";
              }}
            >
              <StopIcon color={tokens.color.danger} />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!canSend}
              title="Send (Enter)"
              aria-label="Send message"
              className="pa-focus-ring"
              style={{
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 34,
                height: 34,
                borderRadius: tokens.radius.md,
                background: canSend ? "#fff" : tokens.color.bgOverlay,
                border: `1px solid ${canSend ? "#fff" : tokens.color.border}`,
                color: canSend ? "#000" : tokens.color.textDim,
                cursor: canSend ? "pointer" : "not-allowed",
                opacity: canSend ? 1 : 0.6,
                transition: `all ${tokens.motion.fast} ${tokens.motion.ease}`,
                boxShadow: canSend ? `0 0 16px ${tokens.color.accent}44` : undefined,
              }}
              onMouseEnter={(e) => {
                if (canSend) e.currentTarget.style.background = "#f4f4f4";
              }}
              onMouseLeave={(e) => {
                if (canSend) e.currentTarget.style.background = "#fff";
              }}
            >
              <SendIcon color={canSend ? "#000" : tokens.color.textDim} />
            </button>
          )}
        </div>

        {/* Pending follow-up chips below the input */}
        {followUps.length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: tokens.space.xs }}>
            {followUps.map((f) => (
              <span
                key={f.id}
                title={f.text}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  maxWidth: "100%",
                  padding: "2px 8px",
                  background: tokens.color.accentSoft,
                  border: `1px solid ${tokens.color.accentBorder}`,
                  borderRadius: tokens.radius.full,
                  color: tokens.color.accentHover,
                  fontSize: tokens.font.size.xs,
                  fontFamily: tokens.font.mono,
                  whiteSpace: "nowrap",
                }}
              >
                <span style={{ opacity: 0.8 }}>↪</span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                  {f.text}
                </span>
              </span>
            ))}
            <Text variant="micro" tone="dim">
              queued · Alt+Up to retrieve · Esc to clear
            </Text>
          </div>
        ) : null}

        {/* Footer hints */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: tokens.space.sm, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: tokens.space.sm, flexWrap: "wrap" }}>
            <Kbd>Enter</Kbd>
            <Text variant="micro" tone="dim">
              {busy ? "steer" : "send"}
            </Text>
            <Kbd>Alt</Kbd>
            <Kbd>Enter</Kbd>
            <Text variant="micro" tone="dim">
              follow-up
            </Text>
            <Kbd>@</Kbd>
            <Text variant="micro" tone="dim">
              file
            </Text>
            <Kbd>!</Kbd>
            <Text variant="micro" tone="dim">
              shell
            </Text>
            <Kbd>Shift</Kbd>
            <Text variant="micro" tone="dim">
              + Enter newline
            </Text>
          </div>
          <Text variant="micro" tone="dim" mono>
            {busy ? "streaming…" : "ready"}
          </Text>
        </div>
      </div>
    </div>
  );
}
