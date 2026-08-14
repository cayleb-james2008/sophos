// ComposerInput — the prompt input box: editor state, TUI-parity key handling,
// auto-growing textarea, file-ref hint popover, and the abort/send action.

import React, { useEffect, useRef, useState } from "react";
import { tokens } from "../../design/tokens";
import { Text, Button } from "../../design";
import { useIpc } from "../../ipc/client";
import type { SlashCommand } from "../../ipc/contract";
import { SendIcon, StopIcon } from "./chatIcons";
import { SlashAutocomplete, filterSlashCommands } from "./SlashAutocomplete";
import { setComposerText, useComposerText } from "./composerTextRef";

type Props = {
  busy: boolean;
  setupReady: boolean;
  editDraft: { index: number; text: string } | null;
  starterDraft: { seq: number; text: string } | null;
  onSend: (text: string) => void;
  onAbort: () => void;
  onSteer: (text: string) => void;
  onQueueFollowUp: (text: string) => void;
  onClearFollowUps: () => void;
  onPopFollowUp: () => string | undefined;
  onSideQuestion: (kind: "btw" | "side", question: string) => void;
  onShell: (command: string, hidden: boolean) => void;
  onSetName: (name: string) => void;
};

export function ComposerInput({ busy, setupReady, editDraft, starterDraft, onSend, onAbort, onSteer, onQueueFollowUp, onClearFollowUps, onPopFollowUp, onSideQuestion, onShell, onSetName }: Props) {
  // The composer's text is owned by the shared composerTextRef store, so the
  // ⌘K palette can read it (save) and write it (insert) from any view. Driving
  // the controlled textarea from useComposerText() means the value initializes
  // from the current snapshot on mount — a template inserted while the composer
  // was unmounted (user on another view) lands here — and every write below
  // publishes through setComposerText so save always sees the live text.
  const value = useComposerText();
  const taRef = useRef<HTMLTextAreaElement>(null);
  const canSend = value.trim().length > 0 && !busy && setupReady;

  // Slash-command autocomplete state. The command list comes from the daemon
  // via IPC (the mock in browser preview), never hardcoded in this component.
  const ipc = useIpc();
  const [slashCommands, setSlashCommands] = useState<SlashCommand[]>([]);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState("");
  const [slashSelectedIdx, setSlashSelectedIdx] = useState(0);

  useEffect(() => {
    ipc.getSlashCommands().then(setSlashCommands).catch(() => {});
  }, [ipc]);

  // Recompute the slash dropdown state from the current value + cursor. The
  // dropdown is open only when the value starts with '/', the cursor is on the
  // first line, and no space has been typed after the command yet.
  const updateSlashState = (v: string, cursor: number | null) => {
    const firstLine = cursor == null ? true : v.slice(0, cursor).indexOf("\n") === -1;
    const afterSlash = v.slice(1);
    if (v.startsWith("/") && firstLine && !afterSlash.includes(" ")) {
      setSlashOpen(true);
      setSlashQuery(afterSlash);
      setSlashSelectedIdx(0);
    } else {
      setSlashOpen(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    setComposerText(v);
    updateSlashState(v, e.target.selectionStart);
  };

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
  const clearInput = () => { setComposerText(""); focusInput(); };

  // Load edit-and-resend draft; keyed by starter seq so re-picking refills.
  useEffect(() => {
    if (editDraft) { setComposerText(editDraft.text); focusInput(); }
  }, [editDraft]);
  useEffect(() => {
    if (starterDraft) { setComposerText(starterDraft.text); focusInput(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [starterDraft?.seq]);

  // Route a submitted line by prefix + busy state.
  const submit = () => {
    const raw = value;
    const trimmed = raw.trim();
    if (raw.startsWith("/btw ") || raw.startsWith("/side ")) {
      const kind: "btw" | "side" = raw.startsWith("/btw ") ? "btw" : "side";
      const q = (kind === "btw" ? raw.slice(5) : raw.slice(6)).trim();
      if (q) { onSideQuestion(kind, q); clearInput(); }
      return;
    }
    if (raw.startsWith("!!")) { const cmd = raw.slice(2).trim(); if (cmd) { onShell(cmd, true); clearInput(); } return; }
    if (raw.startsWith("!")) { const cmd = raw.slice(1).trim(); if (cmd) { onShell(cmd, false); clearInput(); } return; }
    if (raw.startsWith("/name ")) { const name = raw.slice(6).trim(); if (name) { onSetName(name); clearInput(); } return; }
    if (!trimmed || !setupReady) return;
    if (busy) { onSteer(trimmed); clearInput(); return; }
    onSend(trimmed);
    clearInput();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Slash autocomplete intercepts keys ONLY while the dropdown is open.
    if (slashOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashSelectedIdx((i) => (i + 1) % 8);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashSelectedIdx((i) => (i - 1 + 8) % 8);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const matches = filterSlashCommands(slashCommands, slashQuery);
        const selected = matches[slashSelectedIdx];
        if (selected) {
          setComposerText(`/${selected.name} `);
          setSlashOpen(false);
          focusInput();
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSlashOpen(false);
        return;
      }
    }
    // Escape clears text (idle) or queued follow-ups (busy).
    if (e.key === "Escape") {
      if (busy) onClearFollowUps();
      else setComposerText("");
      e.preventDefault();
      return;
    }
    // Alt+Up retrieves the last queued follow-up into the editor.
    if (e.key === "ArrowUp" && e.altKey) {
      e.preventDefault();
      const popped = onPopFollowUp();
      if (popped !== undefined) setComposerText(popped);
      focusInput();
      return;
    }
    // Alt+Enter queues a follow-up.
    if (e.key === "Enter" && e.altKey) {
      e.preventDefault();
      const t = value.trim();
      if (t) { onQueueFollowUp(t); setComposerText(""); focusInput(); }
      return;
    }
    // Enter sends (idle) or steers (busy); Shift+Enter is a newline.
    if (e.key === "Enter" && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      submit();
    }
  };

  const fileHintVisible = value.includes("@");
  const slashMatches = slashOpen ? filterSlashCommands(slashCommands, slashQuery) : [];

  return (
    <div className="composer-input">
      {fileHintVisible ? (
        <div className="composer-input-filehint">
          <Text variant="micro" tone="accent" mono>@</Text>
          <Text variant="micro" tone="muted">reference a project file</Text>
        </div>
      ) : null}

      {slashOpen && slashMatches.length > 0 ? (
        <SlashAutocomplete
          commands={slashCommands}
          query={slashQuery}
          onSelect={(cmd) => { setComposerText(`/${cmd.name} `); setSlashOpen(false); focusInput(); }}
          onDismiss={() => setSlashOpen(false)}
          selectedIndex={slashSelectedIdx}
          onSelectedIndexChange={setSlashSelectedIdx}
        />
      ) : null}

      <textarea ref={taRef} value={value} onChange={handleChange} onKeyDown={onKeyDown}
        placeholder={busy ? "Working… type to steer (Enter), queue a follow-up (Alt+Enter)" : setupReady ? "Message Sophos…  (@ file · ! shell · /btw side question)" : "Finish setup above to enable your first chat"}
        rows={1} aria-label="Message input" className="composer-input-textarea pa-focus-ring" />

      {busy ? (
        <Button variant="danger" type="button" onClick={onAbort} title="Stop generating" aria-label="Stop generating"
          className="composer-input-btn composer-input-btn--stop">
          <StopIcon color={tokens.color.danger} />
        </Button>
      ) : (
        <Button variant="primary" type="button" onClick={submit} disabled={!canSend} title="Send (Enter)" aria-label="Send message"
          className={`composer-input-btn ${canSend ? "composer-input-btn--send" : "composer-input-btn--send-disabled"}`}>
          <SendIcon color={canSend ? tokens.color.bg : tokens.color.textDim} />
        </Button>
      )}
    </div>
  );
}
