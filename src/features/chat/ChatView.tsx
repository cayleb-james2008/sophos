// ChatView — the Operate surface: transcript, streaming state, onboarding,
// session actions, and composer. Presentation lives in chat.css so the view can
// share the same design-system layer as the shell.

import { useEffect, useRef, useState } from "react";
import { Text, StatusDot, Button, IconButton } from "../../design";
import { useConnectionState, useIpc, isTauri } from "../../ipc/client";
import { useAppState } from "../../state/AppState";
import { ModelSelector } from "../providers/ModelSelector";
import { ProfileSelector } from "../profiles/ProfileSelector";
import { useProfile } from "../profiles/profiles";
import { useChat } from "./useChat";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";
import { ContextBar } from "./ContextBar";
import { useOnboardingStatus } from "../settings/FirstRunBanner";
import { OnboardingWizard } from "../settings/OnboardingWizard";
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

function CopyIcon({ size = 13, color }: { size?: number; color: string }) {
  return <svg className="chat-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>;
}

function TrajectoryIcon({ size = 14, color }: { size?: number; color: string }) {
  return <svg className="chat-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="M6 8.5v3a4 4 0 0 0 4 4h5" /><path d="M8.5 6H15a3 3 0 0 1 3 3v6" /></svg>;
}

function CodeIcon({ size = 14, color }: { size?: number; color: string }) {
  return <svg className="chat-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg>;
}

export function ChatView() {
  const { setNewSessionOpen, setSettingsTab, setView, setTrajectoryOpen, setCodeOpen } = useAppState();
  const openNewSession = () => setNewSessionOpen(true);
  const { profile, selection } = useProfile();
  // Code Mode is active when the runtime mode or the profile itself is "code"
  // — that's when the run_code view is reachable from the header.
  const isCodeMode = selection.mode === "code" || profile.id === "code";
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
    requestEdit, retry,
  } = chat;

  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  const [developerPreviewOpen, setDeveloperPreviewOpen] = useState(false);
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
  const onExport = () => { void ipc.exportToHtml().catch(() => {}); showToast("Exporting session to HTML…"); };
  const onCopy = async () => {
    if (!lastAssistant) { showToast("No assistant message to copy"); return; }
    try { await navigator.clipboard.writeText(lastAssistant); showToast("Copied last assistant message"); }
    catch { showToast("Copy failed"); }
  };

  useEffect(() => () => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
  }, []);

  const headerButtons = [
    { title: "Export session to HTML", onClick: onExport, icon: (color: string) => <ExportIcon color={color} /> },
    { title: "Copy last assistant message", onClick: () => void onCopy(), icon: (color: string) => <CopyIcon color={color} /> },
    { title: "Trajectory", onClick: () => setTrajectoryOpen(true), icon: (color: string) => <TrajectoryIcon color={color} /> },
  ];

  // Error-card retry re-issues the last assistant turn (which re-sends the
  // preceding user prompt). No assistant message yet → nothing to retry.
  const lastRetryable = [...messages].reverse().find((message) => message.role === "assistant");
  const onErrorRetry = () => { if (lastRetryable) retry(lastRetryable); };

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
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            New session
          </Button>
          {isCodeMode ? (
            <IconButton title="Code Mode — SDK + run_code programs" className="chat-action-button" onClick={() => setCodeOpen(true)} aria-label="Open Code Mode">
              <CodeIcon color="currentColor" />
            </IconButton>
          ) : null}
          <ProfileSelector />
          <ModelSelector />
        </div>
      </header>

      {error ? (
        <div className="chat-error" role="alert">
          <span className="chat-error-icon" aria-hidden="true">!</span>
          <div className="chat-error-body">
            <Text variant="label" tone="danger">Something went wrong</Text>
            <Text variant="label" tone="muted">{error}</Text>
          </div>
          <Button variant="outline" type="button" onClick={onErrorRetry} disabled={!lastRetryable} className="chat-error-retry">Retry</Button>
        </div>
      ) : null}

      <OnboardingWizard onSetupProviders={handleSetupProviders} onStartChat={onStartChat} hasFirstMessage={hasFirstMessage} setup={onboarding} />

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
        <MessageList messages={messages} busy={busy} onRetry={retry} onEdit={(index, message) => requestEdit(index, message.content)} hasProvider={hasProvider} onFillPrompt={fillPrompt} />
      ) : (
        <div className="chat-loading" aria-busy="true" aria-live="polite">
          <div className="chat-loading-skeleton">
            <div className="chat-loading-line chat-loading-line--short" />
            <div className="chat-loading-line chat-loading-line--med" />
            <div className="chat-loading-line" />
            <div className="chat-loading-line chat-loading-line--med" />
            <div className="chat-loading-line chat-loading-line--short" />
          </div>
        </div>
      )}

      <ContextBar stats={contextStats} />
      <Composer
        busy={busy}
        setupReady={!isTauri || onboarding.ready}
        editDraft={editDraft}
        starterDraft={starterDraft}
        profileName={profile.name}
        profileTagline={profile.tagline}
        codeMode={isCodeMode}
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
    </div>
  );
}
