// ChatView — the Operate surface: transcript, streaming state, onboarding,
// session actions, and composer. Presentation lives in chat.css so the view can
// share the same design-system layer as the shell.

import { useEffect, useRef, useState } from "react";
import { Text, StatusDot, Button, IconButton, Modal } from "../../design";
import { useConnectionState, useIpc, isTauri } from "../../ipc/client";
import type { TranscriptMessage } from "../../ipc/contract";
import { save } from "@tauri-apps/plugin-dialog";
import { useAppState } from "../../state/AppState";
import { ModelSelector } from "../providers/ModelSelector";
import { useChat } from "./useChat";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";
import { ContextBar } from "./ContextBar";
import { FirstRunBanner, useOnboardingStatus } from "../settings/FirstRunBanner";
import "./chat.css";

function statusDotState(status: { kind: string }): "connecting" | "connected" | "disconnected" | "reconnecting" {
  switch (status.kind) {
    case "connecting": return "connecting";
    case "connected": return "connected";
    case "reconnecting": return "reconnecting";
    default: return "disconnected";
  }
}

function ExportIcon({ size = 13, color }: { size?: number; color: string }) {
  return <svg className="chat-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>;
}

function ShareIcon({ size = 13, color }: { size?: number; color: string }) {
  return <svg className="chat-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.6" y1="13.5" x2="15.4" y2="17.5" /><line x1="15.4" y1="6.5" x2="8.6" y2="10.5" /></svg>;
}

function CopyIcon({ size = 13, color }: { size?: number; color: string }) {
  return <svg className="chat-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>;
}

export function ChatView() {
  const { setNewSessionOpen, setSettingsTab, setView } = useAppState();
  const openNewSession = () => setNewSessionOpen(true);
  const handleSetupProviders = () => {
    setSettingsTab("providers");
    setView("settings");
  };
  const chat = useChat();
  const ipc = useIpc();
  const state = useConnectionState();
  const onboarding = useOnboardingStatus();
  const { hasProvider } = onboarding;
  const {
    messages, busy, loaded, error, hasFirstMessage, send, steer, abort,
    queueFollowUp, clearFollowUps, popFollowUp, followUps, steered,
    shellNotice, askSideQuestion, dismissSideQuestion, sideQuestions,
    runShell, contextStats, setSessionName, editDraft,
    requestEdit, retry, reload,
  } = chat;

  const { compact } = chat;

  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  const [developerPreviewOpen, setDeveloperPreviewOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant")?.content ?? "";
  const starterSeq = useRef(0);
  const [starterDraft, setStarterDraft] = useState<{ seq: number; text: string } | null>(null);

  const showToast = (message: string) => {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  };
  const fillPrompt = (text: string) => setStarterDraft({ seq: ++starterSeq.current, text });
  const onStartChat = () => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message input"]')?.focus();

  // Export: open the format picker (HTML / JSONL), then the native save dialog,
  // then the matching IPC export. Honest toast with the saved path or the error.
  const onExport = () => setExportOpen(true);
  const runExport = async (format: "html" | "jsonl") => {
    setExportOpen(false);
    try {
      let path: string | null = null;
      if (isTauri) {
        path = await save({
          defaultPath: `sophos-session.${format}`,
          filters: [{ name: format === "html" ? "HTML" : "JSONL", extensions: [format] }],
        });
        if (!path) return; // user cancelled the save dialog
      }
      const result =
        format === "html" ? await ipc.exportToHtml(path ?? undefined) : await ipc.exportToJsonl(path ?? undefined);
      showToast(`Exported to ${result.outputPath}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    }
  };

  // Share: run the daemon's share command and surface the real result — never a stub.
  const onShare = async () => {
    try {
      await ipc.runCommand("share");
      showToast("Session shared");
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    }
  };

  // Fork a new session from an assistant message, then reload the transcript so
  // the view reflects the new session. Honest toast on success or failure.
  const onFork = async (message: TranscriptMessage) => {
    try {
      await ipc.forkSession(message.id);
      showToast("Forked — new session created from this message.");
      await reload();
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    }
  };

  // The ⌘K palette's /export and /share commands dispatch custom window events so
  // ChatView keeps ownership of the IPC calls + toasts without re-wiring the
  // palette's buildPaletteCommands signature across the App shell.
  const onExportRef = useRef(onExport);
  onExportRef.current = onExport;
  const onShareRef = useRef(onShare);
  onShareRef.current = onShare;
  useEffect(() => {
    const handleExport = () => onExportRef.current();
    const handleShare = () => void onShareRef.current();
    window.addEventListener("sophos:request-export", handleExport);
    window.addEventListener("sophos:request-share", handleShare);
    return () => {
      window.removeEventListener("sophos:request-export", handleExport);
      window.removeEventListener("sophos:request-share", handleShare);
    };
  }, []);

  const onCopy = async () => {
    if (!lastAssistant) { showToast("No assistant message to copy"); return; }
    try { await navigator.clipboard.writeText(lastAssistant); showToast("Copied last assistant message"); }
    catch { showToast("Copy failed"); }
  };

  useEffect(() => () => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
  }, []);

  const headerButtons = [
    { title: "Export session", onClick: onExport, icon: (color: string) => <ExportIcon color={color} /> },
    { title: "Share as GitHub gist", onClick: () => void onShare(), icon: (color: string) => <ShareIcon color={color} /> },
    { title: "Copy last assistant message", onClick: () => void onCopy(), icon: (color: string) => <CopyIcon color={color} /> },
  ];

  return (
    <div className="chat-view">
      <header className="chat-header" data-view-header>
        <div className="chat-heading">
          <Text variant="micro" tone="dim" mono uppercase>Chat</Text>
          <Text variant="subtitle" weight="semibold">Conversation</Text>
        </div>

        <div className="chat-actions">
          <div className="chat-status">
            <StatusDot state={statusDotState(state.status)} />
            <Text variant="micro" tone="muted" mono uppercase>{state.status.kind}</Text>
          </div>
          {headerButtons.map((button) => (
            <IconButton key={button.title} title={button.title} className="chat-action-button" onClick={button.onClick}>
              {button.icon("currentColor")}
            </IconButton>
          ))}
          <Button variant="outline" onClick={openNewSession} title="New session" className="chat-new-button">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            New session
          </Button>
          <ModelSelector />
        </div>
      </header>

      {error ? <div className="chat-error"><Text variant="label" tone="danger">{error}</Text></div> : null}

      <FirstRunBanner onSetupProviders={handleSetupProviders} onStartChat={onStartChat} hasFirstMessage={hasFirstMessage} setup={onboarding} />

      {import.meta.env.DEV && !isTauri ? (
        <div className="chat-demo">
          <span className="chat-demo-dot" aria-hidden="true" />
          <Text variant="label" tone="muted">Demo mode — engine not connected. Responses here are simulated and do not reflect real tools or data.</Text>
          <details open={developerPreviewOpen} className="chat-developer-preview">
            <summary onClick={(event) => { event.preventDefault(); setDeveloperPreviewOpen((open) => !open); }} className="chat-developer-summary">Developer preview</summary>
            <div hidden={!developerPreviewOpen}>
              <Button variant="outline" type="button" onClick={() => chat.loadDemoMessages(500)} title="Seed a 500-message transcript to test windowed rendering" className="chat-demo-button">Load 500 messages</Button>
            </div>
          </details>
        </div>
      ) : null}

      {loaded ? (
        <MessageList messages={messages} busy={busy} onRetry={retry} onEdit={(index, message) => requestEdit(index, message.content)} onFork={onFork} hasProvider={hasProvider} onFillPrompt={fillPrompt} />
      ) : (
        <div className="chat-loading"><Text variant="label" tone="dim">Loading transcript…</Text></div>
      )}

      <ContextBar stats={contextStats} onCompact={compact} />
      <Composer
        busy={busy}
        setupReady={!isTauri || onboarding.ready}
        editDraft={editDraft}
        starterDraft={starterDraft}
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

      {toast ? <div role="status" className="chat-toast"><Text variant="label" tone="accent">{toast}</Text></div> : null}

      {/* Export format picker — HTML / JSONL, then the native save dialog. */}
      <Modal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title="Export session"
        footer={
          <Button variant="ghost" onClick={() => setExportOpen(false)}>
            Cancel
          </Button>
        }
      >
        <div className="export-picker">
          <Text variant="body" tone="muted">
            Choose a format to export the current session.
          </Text>
          <div className="export-picker__actions">
            <Button variant="outline" onClick={() => void runExport("html")}>
              HTML
            </Button>
            <Button variant="outline" onClick={() => void runExport("jsonl")}>
              JSONL
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
