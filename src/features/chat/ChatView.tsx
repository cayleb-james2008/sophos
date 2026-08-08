// ChatView — the chat experience: message list, streaming assistant messages,
// thinking display, tool/IPython call rendering, prompt input, steer/follow-up
// queue, inline side questions, a context/usage bar, and the model/provider
// selector. Header actions (Export / Share / Copy) mirror the TUI. Wired to
// the IPC client.

import { useEffect, useRef, useState } from "react";
import { tokens } from "../../design/tokens";
import { Text, StatusDot } from "../../design";
import { useConnectionState, useIpc, isTauri } from "../../ipc/client";
import { ModelSelector } from "../providers/ModelSelector";
import { useChat } from "./useChat";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";
import { ContextBar } from "./ContextBar";

function statusDotState(status: { kind: string }): "connecting" | "connected" | "disconnected" | "reconnecting" {
  switch (status.kind) {
    case "connecting":
      return "connecting";
    case "connected":
      return "connected";
    case "disconnected":
      return "disconnected";
    case "reconnecting":
      return "reconnecting";
    default:
      return "disconnected";
  }
}

// Small line icons for the header actions, matching the Sophos token palette.
function ExportIcon({ size = 13, color }: { size?: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function ShareIcon({ size = 13, color }: { size?: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.6" y1="13.5" x2="15.4" y2="17.5" />
      <line x1="15.4" y1="6.5" x2="8.6" y2="10.5" />
    </svg>
  );
}

function CopyIcon({ size = 13, color }: { size?: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

export function ChatView({ onNewSession }: { onNewSession?: () => void }) {
  const chat = useChat();
  const ipc = useIpc();
  const state = useConnectionState();
  const {
    messages,
    busy,
    loaded,
    error,
    send,
    steer,
    abort,
    queueFollowUp,
    clearFollowUps,
    popFollowUp,
    followUps,
    steered,
    shellNotice,
    askSideQuestion,
    dismissSideQuestion,
    sideQuestions,
    runShell,
    contextStats,
    setSessionName,
  } = chat;

  // ---- Toast for header actions ----
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  };

  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant")?.content ?? "";

  const onExport = () => {
    void ipc.exportToHtml().catch(() => {});
    showToast("Exporting session to HTML…");
  };
  const onShare = () => {
    // The daemon does not support share (bridge returns -32601). Keep the call
    // best-effort but surface a graceful notice instead of a dead end.
    void ipc.runCommand("share").catch(() => {});
    showToast("Share not available yet");
  };
  const onCopy = async () => {
    if (!lastAssistant) {
      showToast("No assistant message to copy");
      return;
    }
    try {
      await navigator.clipboard.writeText(lastAssistant);
      showToast("Copied last assistant message");
    } catch {
      showToast("Copy failed");
    }
  };

  // Cleanup toast timer on unmount.
  useEffect(() => {
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    };
  }, []);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        position: "relative",
      }}
    >
      {/* Header */}
      <header
        style={{
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: tokens.space.lg,
          padding: `${tokens.space.md} ${tokens.space.xl}`,
          borderBottom: `1px solid ${tokens.color.border}`,
          background: `linear-gradient(180deg, ${tokens.color.bgElevated}cc, transparent)`,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <Text variant="micro" tone="accent" mono uppercase style={{ letterSpacing: "0.12em" }}>
            Chat
          </Text>
          <Text variant="subtitle" weight="semibold" style={{ letterSpacing: "-0.01em" }}>
            Conversation
          </Text>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: tokens.space.md }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: tokens.space.sm,
              padding: "4px 10px",
              borderRadius: tokens.radius.full,
              background: tokens.color.bgRaised,
              border: `1px solid ${tokens.color.border}`,
            }}
          >
            <StatusDot state={statusDotState(state.status)} />
            <Text variant="micro" tone="muted" mono uppercase>
              {state.status.kind}
            </Text>
          </div>

          {/* Export / Share / Copy */}
          {[
            { title: "Export session to HTML", onClick: onExport, icon: (c: string) => <ExportIcon color={c} /> },
            { title: "Share as GitHub gist", onClick: onShare, icon: (c: string) => <ShareIcon color={c} /> },
            { title: "Copy last assistant message", onClick: () => void onCopy(), icon: (c: string) => <CopyIcon color={c} /> },
          ].map((b) => (
            <button
              key={b.title}
              type="button"
              onClick={b.onClick}
              title={b.title}
              aria-label={b.title}
              className="pa-focus-ring"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 30,
                height: 30,
                borderRadius: tokens.radius.md,
                background: tokens.color.bgRaised,
                border: `1px solid ${tokens.color.border}`,
                color: tokens.color.textMuted,
                cursor: "pointer",
                transition: `all ${tokens.motion.fast} ${tokens.motion.ease}`,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = tokens.color.accentBorder;
                e.currentTarget.style.color = tokens.color.text;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = tokens.color.border;
                e.currentTarget.style.color = tokens.color.textMuted;
              }}
            >
              {b.icon("currentColor")}
            </button>
          ))}

          {onNewSession ? (
            <button
              type="button"
              onClick={onNewSession}
              title="New session"
              className="pa-focus-ring"
              style={{
                display: "flex",
                alignItems: "center",
                gap: tokens.space.sm,
                padding: "5px 10px",
                borderRadius: tokens.radius.md,
                background: tokens.color.bgRaised,
                border: `1px solid ${tokens.color.border}`,
                color: tokens.color.textMuted,
                cursor: "pointer",
                fontFamily: tokens.font.sans,
                fontSize: tokens.font.size.xs,
                fontWeight: tokens.font.weight.medium,
                transition: `all ${tokens.motion.fast} ${tokens.motion.ease}`,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = tokens.color.accentBorder;
                e.currentTarget.style.color = tokens.color.text;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = tokens.color.border;
                e.currentTarget.style.color = tokens.color.textMuted;
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              New session
            </button>
          ) : null}
          <ModelSelector />
        </div>
      </header>

      {/* Error banner */}
      {error ? (
        <div
          style={{
            flexShrink: 0,
            padding: `${tokens.space.sm} ${tokens.space.xl}`,
            background: tokens.color.danger + "1a",
            borderBottom: `1px solid ${tokens.color.danger}44`,
          }}
        >
          <Text variant="label" tone="danger">
            {error}
          </Text>
        </div>
      ) : null}

      {/* Demo-mode banner: visible only in the browser preview (no Tauri). */}
      {!isTauri ? (
        <div
          style={{
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: tokens.space.sm,
            padding: `${tokens.space.sm} ${tokens.space.xl}`,
            background: tokens.color.warning + "14",
            borderBottom: `1px solid ${tokens.color.warning}40`,
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: tokens.color.warning,
              flexShrink: 0,
            }}
            aria-hidden
          />
          <Text variant="label" tone="muted">
            Demo mode — engine not connected. Responses here are simulated and do not reflect real tools or data.
          </Text>
        </div>
      ) : null}

      {/* Message list */}
      {loaded ? (
        <MessageList messages={messages} />
      ) : (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Text variant="label" tone="dim">
            Loading transcript…
          </Text>
        </div>
      )}

      {/* Context / usage bar */}
      <ContextBar stats={contextStats} />

      {/* Composer */}
      <Composer
        busy={busy}
        onSend={send}
        onAbort={abort}
        onSteer={steer}
        onQueueFollowUp={queueFollowUp}
        onClearFollowUps={clearFollowUps}
        onPopFollowUp={popFollowUp}
        followUps={followUps}
        steered={steered}
        shellNotice={shellNotice}
        onSideQuestion={askSideQuestion}
        sideQuestions={sideQuestions}
        onDismissSideQuestion={dismissSideQuestion}
        onShell={runShell}
        onSetName={setSessionName}
      />

      {/* Toast */}
      {toast ? (
        <div
          role="status"
          style={{
            position: "absolute",
            right: tokens.space.xl,
            bottom: 96,
            padding: "7px 14px",
            background: tokens.color.bgOverlay,
            border: `1px solid ${tokens.color.borderStrong}`,
            borderRadius: tokens.radius.md,
            boxShadow: tokens.shadow.lg,
          }}
        >
          <Text variant="label" tone="accent">
            {toast}
          </Text>
        </div>
      ) : null}
    </div>
  );
}
