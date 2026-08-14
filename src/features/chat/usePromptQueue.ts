// usePromptQueue — owns the steering / follow-up message queue plus the
// transient steer and shell notices. The queue mirrors the TUI behavior:
// Enter while busy steers (delivered after the current tool calls), Alt+Enter
// queues a follow-up delivered after all work, Escape clears queued follow-ups,
// and Alt+Up pops the last queued follow-up back into the editor.
//
// The orchestrator owns `busy` and the shared `busyRef`; `sendRef` is the
// orchestrator's latest send implementation so the drain loop can re-dispatch
// queued prompts without a construction-order dependency.

import { useCallback, useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";

export interface FollowUp {
  id: number;
  text: string;
}

interface PromptQueueOptions {
  busy: boolean;
  busyRef: MutableRefObject<boolean>;
  sendRef: MutableRefObject<(text: string) => Promise<void>>;
}

export function usePromptQueue({ busy, busyRef, sendRef }: PromptQueueOptions) {
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const followUpsRef = useRef<FollowUp[]>([]);
  const followUpSeq = useRef(0);
  const flushingRef = useRef(false);
  const [steered, setSteered] = useState<{ text: string; at: number } | null>(null);
  const [shellNotice, setShellNotice] = useState<{ command: string; hidden: boolean } | null>(null);
  const steeredTimer = useRef<number | null>(null);
  const shellTimer = useRef<number | null>(null);

  const commitFollowUps = useCallback((next: FollowUp[]) => {
    followUpsRef.current = next;
    setFollowUps(next);
  }, []);

  const queueFollowUp = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      followUpSeq.current += 1;
      commitFollowUps([...followUpsRef.current, { id: followUpSeq.current, text: trimmed }]);
    },
    [commitFollowUps],
  );

  const clearFollowUps = useCallback(() => commitFollowUps([]), [commitFollowUps]);

  /** Retrieve the most recently queued follow-up back into the editor. */
  const popFollowUp = useCallback((): string | undefined => {
    const list = followUpsRef.current;
    if (list.length === 0) return undefined;
    const last = list[list.length - 1];
    commitFollowUps(list.slice(0, -1));
    return last.text;
  }, [commitFollowUps]);

  const showSteered = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setSteered({ text: trimmed, at: Date.now() });
    if (steeredTimer.current) window.clearTimeout(steeredTimer.current);
    steeredTimer.current = window.setTimeout(() => setSteered(null), 4000);
  }, []);

  const showShellNotice = useCallback((command: string, hidden: boolean) => {
    const cmd = command.trim();
    if (!cmd) return;
    setShellNotice({ command: cmd, hidden });
    if (shellTimer.current) window.clearTimeout(shellTimer.current);
    shellTimer.current = window.setTimeout(() => setShellNotice(null), 4000);
  }, []);

  // Drain the queued follow-ups one at a time — each is delivered only after
  // the previous unit of work finishes (busy → idle). busyRef guards re-entry
  // because send flips it synchronously before its first await.
  const tryFlushFollowUps = useCallback(() => {
    if (flushingRef.current) return;
    if (busyRef.current) return;
    if (followUpsRef.current.length === 0) return;
    flushingRef.current = true;
    const [first, ...rest] = followUpsRef.current;
    commitFollowUps(rest);
    void sendRef.current(first.text).finally(() => {
      flushingRef.current = false;
      tryFlushFollowUps();
    });
  }, [commitFollowUps, busyRef, sendRef]);

  // Flush when local busy clears (demo + Tauri user_message cycles).
  useEffect(() => {
    const wasBusy = busyRef.current;
    busyRef.current = busy;
    if (wasBusy && !busy) tryFlushFollowUps();
  }, [busy, tryFlushFollowUps, busyRef]);

  // Clear transient notices on unmount.
  useEffect(() => () => {
    if (steeredTimer.current) window.clearTimeout(steeredTimer.current);
    if (shellTimer.current) window.clearTimeout(shellTimer.current);
  }, []);

  return {
    followUps,
    steered,
    shellNotice,
    queueFollowUp,
    clearFollowUps,
    popFollowUp,
    showSteered,
    showShellNotice,
    tryFlushFollowUps,
  };
}
