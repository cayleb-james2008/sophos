// useChat — the chat state engine. It composes the transcript, prompt-queue,
// and side-question slices into a single orchestration surface, and owns the
// remaining turn lifecycle (busy/error), the live context/usage stats, the
// daemon-idle reconciliation, and the shell/session-name actions.
//
// Two modes:
//   * Tauri  — real IPC: prompt()/abort()/steer() drive the daemon; session
//              events update the transcript live.
//   * Browser — the MockIpcClient has no real stream, so the preview starts
//              empty and simulates a streaming turn for the user's input.

import { useCallback, useEffect, useRef, useState } from "react";
import { useIpc, useIpcEvent, useConnectionState, isTauri } from "../../ipc/client";
import type { ContextStats } from "../../ipc/contract";
import { useTranscript } from "./useTranscript";
import { usePromptQueue } from "./usePromptQueue";
import { useSideQuestions } from "./useSideQuestions";
import type { FollowUp } from "./usePromptQueue";
import type { SideQuestion, SideQuestionStatus } from "./useSideQuestions";

export type { FollowUp, SideQuestion, SideQuestionStatus };

export function useChat() {
  const client = useIpc();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const sendRef = useRef<(text: string) => Promise<void>>(async () => {});

  const transcript = useTranscript({ setBusy, setError, busyRef });
  const queue = usePromptQueue({ busy, busyRef, sendRef });
  const side = useSideQuestions();

  // ---- Context / usage stats (coalesced into a 150ms flush window) ----
  const [contextStats, setContextStats] = useState<ContextStats | null>(null);
  const pendingStats = useRef<ContextStats | null>(null);
  const statsTimer = useRef<number | null>(null);
  const flushStats = useCallback(() => {
    if (statsTimer.current != null) return;
    statsTimer.current = window.setTimeout(() => {
      statsTimer.current = null;
      if (pendingStats.current) {
        setContextStats((prev) => ({ ...(prev ?? {}), ...pendingStats.current }));
        pendingStats.current = null;
      }
    }, 150);
  }, []);

  const refreshContextStats = useCallback(() => {
    client
      .getContextStats()
      .then((stats) => {
        if (stats) setContextStats(stats);
      })
      .catch(() => {
        // best-effort — the bar simply stays hidden until stats arrive
      });
  }, [client]);

  useEffect(() => {
    refreshContextStats();
    const interval = window.setInterval(refreshContextStats, 5000);
    return () => window.clearInterval(interval);
  }, [refreshContextStats]);

  useEffect(() => () => {
    if (statsTimer.current != null) window.clearTimeout(statsTimer.current);
  }, []);

  // ---- Live IPC: context/usage stats ----
  useIpcEvent((event) => {
    if (event.type !== "session_event") return;
    const kind = event.event.kind;
    if (kind !== "context_stats" && kind !== "usage") return;
    const e = event.event as unknown as Record<string, unknown>;
    const tokens = typeof e.tokens === "number" ? e.tokens : undefined;
    const contextWindow = typeof e.contextWindow === "number" ? e.contextWindow : undefined;
    const messages = typeof e.messages === "number" ? e.messages : undefined;
    pendingStats.current = {
      ...(pendingStats.current ?? {}),
      ...(tokens != null ? { tokens } : {}),
      ...(contextWindow != null ? { contextWindow } : {}),
      ...(messages != null ? { messages } : {}),
    };
    flushStats();
  });

  // ---- Send ----
  const send = useCallback(
    async (text: string): Promise<void> => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;

      // Edit-and-resend: if a user message is pending edit, branch from that
      // point instead of appending a fresh message. History before the edited
      // message is never mutated.
      const pending = transcript.editDraftRef.current;
      if (pending) {
        transcript.editDraftRef.current = null;
        transcript.setEditDraft(null);
        return transcript.editAndResend(pending.index, trimmed);
      }
      return transcript.runTurn(trimmed);
    },
    [busy, transcript],
  );
  sendRef.current = send;

  // ---- Steer (Enter while busy — delivered after current tool calls) ----
  const steer = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      queue.showSteered(trimmed);
      try {
        await client.steer(trimmed);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [client, queue],
  );

  // ---- Abort ----
  const abort = useCallback(async () => {
    if (isTauri) {
      try {
        await client.abort();
      } catch {
        // best-effort
      }
    }
    transcript.simCleanup.current?.();
    transcript.simCleanup.current = null;
    transcript.setMessages((msgs) =>
      msgs.map((m) => (m.status === "streaming" ? { ...m, status: "complete" } : m)),
    );
    setBusy(false);
    transcript.streamingId.current = null;
  }, [client, transcript]);

  // ---- Shell commands (!cmd / !!cmd) ----
  const runShell = useCallback(
    (command: string, hidden: boolean) => {
      const cmd = command.trim();
      if (!cmd) return;
      queue.showShellNotice(cmd, hidden);
      void client.runCommand("exec", [cmd]).catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      });
    },
    [client, queue],
  );

  // ---- Session name (/name <arg>) ----
  const setSessionName = useCallback(
    (name: string) => {
      const n = name.trim();
      if (!n) return;
      void client.setSessionName(n).catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      });
    },
    [client],
  );

  // ---- Flush follow-ups when the daemon reports idle via snapshot ----
  const connState = useConnectionState();
  const daemonIdle = connState.queue?.mode === "idle";
  const prevDaemonIdle = useRef(false);
  useEffect(() => {
    const wasIdle = prevDaemonIdle.current;
    prevDaemonIdle.current = daemonIdle;
    if (daemonIdle && !wasIdle) {
      if (busyRef.current) setBusy(false);
      else queue.tryFlushFollowUps();
    }
  }, [daemonIdle, queue]);

  return {
    messages: transcript.messages,
    busy,
    loaded: transcript.loaded,
    error,
    hasFirstMessage: transcript.hasFirstMessage,
    send,
    steer,
    abort,
    queueFollowUp: queue.queueFollowUp,
    clearFollowUps: queue.clearFollowUps,
    popFollowUp: queue.popFollowUp,
    followUps: queue.followUps,
    steered: queue.steered,
    shellNotice: queue.shellNotice,
    askSideQuestion: side.askSideQuestion,
    dismissSideQuestion: side.dismissSideQuestion,
    sideQuestions: side.sideQuestions,
    runShell,
    contextStats,
    setSessionName,
    loadDemoMessages: transcript.loadDemoMessages,
    editDraft: transcript.editDraft,
    requestEdit: transcript.requestEdit,
    retry: transcript.retry,
  };
}
