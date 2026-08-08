// useChat — the chat state engine. Owns the message list, streaming state,
// send/steer/abort actions, the steering + follow-up message queue, inline side
// questions, live context/usage stats, and the IPC event subscription.
//
// Two modes:
//   * Tauri  — real IPC: prompt()/abort()/steer() drive the daemon; session
//              events update the transcript live.
//   * Browser — the MockIpcClient has no real stream, so we seed a demo
//              conversation and simulate a streaming turn for the preview.
//
// The message queue mirrors the TUI behavior:
//   * Enter while busy      → steer (delivered after the current tool calls)
//   * Alt+Enter             → queue a follow-up, delivered after all work
//   * Escape while busy     → clear queued follow-ups
//   * Alt+Up                → retrieve the last queued follow-up into the editor

import { useCallback, useEffect, useRef, useState } from "react";
import { useIpc, useIpcEvent, useConnectionState, isTauri } from "../../ipc/client";
import type { ContextStats, SessionEvent, TranscriptMessage } from "../../ipc/contract";
import { demoSeed, simulateResponse } from "./demo";

function nowIso(): string {
  return new Date().toISOString();
}

export interface FollowUp {
  id: number;
  text: string;
}

export type SideQuestionStatus = "running" | "complete" | "cancelled" | "error";

export interface SideQuestion {
  id: string;
  kind: "btw" | "side";
  question: string;
  status: SideQuestionStatus;
  answer: string;
}

function normalizeSideStatus(raw: unknown): SideQuestionStatus {
  const s = String(raw ?? "");
  if (s === "complete" || s === "cancelled" || s === "error") return s;
  return "running";
}

export function useChat() {
  const client = useIpc();
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const simCleanup = useRef<(() => void) | null>(null);
  const streamingId = useRef<string | null>(null);

  // ---- Steering / follow-up queue -------------------------------------
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const followUpsRef = useRef<FollowUp[]>([]);
  const followUpSeq = useRef(0);
  const flushingRef = useRef(false);
  const busyRef = useRef(false);
  const [steered, setSteered] = useState<{ text: string; at: number } | null>(null);
  const [shellNotice, setShellNotice] = useState<{ command: string; hidden: boolean } | null>(null);
  const steeredTimer = useRef<number | null>(null);
  const shellTimer = useRef<number | null>(null);

  // ---- Inline side questions ------------------------------------------
  const [sideQuestions, setSideQuestions] = useState<SideQuestion[]>([]);

  // ---- Context / usage stats ------------------------------------------
  const [contextStats, setContextStats] = useState<ContextStats | null>(null);

  // Keep busyRef in sync so the (callback-stable) queue flush can read it.
  // NOTE: busyRef is updated by `send` (set true synchronously before work
  // starts) and by the busy-transition effect (set to `busy`). It must NOT be
  // overwritten here in the render body: doing so clobbers the previous value
  // before the effect runs, so the effect's `wasBusy` capture always equals
  // `busy` and the true→false transition that drains the follow-up queue can
  // never be observed.

  const commitFollowUps = useCallback((next: FollowUp[]) => {
    followUpsRef.current = next;
    setFollowUps(next);
  }, []);

  // ---- Initial transcript load ----
  useEffect(() => {
    let mounted = true;
    client
      .getTranscript()
      .then((t) => {
        if (!mounted) return;
        setMessages(t);
        setLoaded(true);
      })
      .catch(() => {
        if (mounted) setLoaded(true);
      });
    return () => {
      mounted = false;
    };
  }, [client]);

  // ---- Seed demo data in browser mode once loaded & empty ----
  useEffect(() => {
    if (!isTauri && loaded && messages.length === 0) {
      setMessages(demoSeed());
    }
  }, [isTauri, loaded, messages.length]);

  // ---- Cleanup simulation on unmount ----
  useEffect(() => {
    return () => {
      simCleanup.current?.();
    };
  }, []);

  // ---- Context stats: initial load + 5s refresh ----
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

  // ---- Live IPC event handling (real daemon) ----
  useIpcEvent((event) => {
    if (event.type !== "session_event") return;
    handleSessionEvent(event.event);
  });

  const handleSessionEvent = useCallback((evt: SessionEvent) => {
    const kind = evt.kind;
    const e = evt as unknown as Record<string, unknown>;

    switch (kind) {
      case "user_message": {
        const text = typeof e.text === "string" ? e.text : "";
        if (!text) return;
        setMessages((msgs) => [
          ...msgs,
          { id: `u-${Date.now()}`, role: "user", content: text, timestamp: nowIso(), status: "complete" },
        ]);
        setBusy(true);
        return;
      }
      case "message_delta":
      case "message": {
        const text = typeof e.text === "string" ? e.text : typeof e.content === "string" ? e.content : "";
        setMessages((msgs) => {
          const target = msgs.find((m) => m.id === streamingId.current) ?? [...msgs].reverse().find((m) => m.role === "assistant");
          if (!target) {
            return [
              ...msgs,
              { id: `a-${Date.now()}`, role: "assistant", content: text, timestamp: nowIso(), status: "streaming" },
            ];
          }
          return msgs.map((m) =>
            m.id === target.id
              ? { ...m, content: kind === "message_delta" ? `${m.content}${text}` : text, status: "streaming" }
              : m,
          );
        });
        return;
      }
      case "thinking":
      case "thinking_delta": {
        const text = typeof e.text === "string" ? e.text : typeof e.content === "string" ? e.content : "";
        setMessages((msgs) => {
          const target = msgs.find((m) => m.id === streamingId.current) ?? [...msgs].reverse().find((m) => m.role === "assistant");
          if (!target) return msgs;
          return msgs.map((m) =>
            m.id === target.id
              ? { ...m, thinking: kind === "thinking_delta" ? `${m.thinking ?? ""}${text}` : text }
              : m,
          );
        });
        return;
      }
      case "tool_call":
      case "tool_use": {
        const name = typeof e.name === "string" ? e.name : typeof e.toolName === "string" ? e.toolName : "tool";
        const input = typeof e.input === "string" ? e.input : e.input !== undefined ? JSON.stringify(e.input) : undefined;
        setMessages((msgs) => {
          const target = msgs.find((m) => m.id === streamingId.current) ?? [...msgs].reverse().find((m) => m.role === "assistant");
          if (!target) return msgs;
          const tc = { id: `tc-${Date.now()}`, name, input, status: "running" as const };
          return msgs.map((m) =>
            m.id === target.id ? { ...m, toolCalls: [...(m.toolCalls ?? []), tc] } : m,
          );
        });
        return;
      }
      case "tool_result":
      case "tool_output": {
        const output = typeof e.output === "string" ? e.output : e.output !== undefined ? JSON.stringify(e.output) : undefined;
        const name = typeof e.name === "string" ? e.name : typeof e.toolName === "string" ? e.toolName : undefined;
        setMessages((msgs) => {
          const target = msgs.find((m) => m.id === streamingId.current) ?? [...msgs].reverse().find((m) => m.role === "assistant");
          if (!target) return msgs;
          return msgs.map((m) => {
            if (m.id !== target.id) return m;
            const calls = (m.toolCalls ?? []).map((tc, i) => {
              const match = name ? tc.name === name : i === (m.toolCalls?.length ?? 1) - 1;
              return match ? { ...tc, output, status: "complete" as const } : tc;
            });
            return { ...m, toolCalls: calls };
          });
        });
        return;
      }
      case "error": {
        const text = typeof e.message === "string" ? e.message : typeof e.error === "string" ? e.error : "An error occurred";
        setMessages((msgs) =>
          msgs.map((m) => (m.id === streamingId.current ? { ...m, status: "error" as const } : m)),
        );
        setError(text);
        setBusy(false);
        streamingId.current = null;
        return;
      }
      case "side_question_event": {
        const id = typeof e.id === "string" ? e.id : "";
        if (!id) return;
        setSideQuestions((sqs) =>
          sqs.map((sq) => (sq.id === id ? { ...sq, status: normalizeSideStatus(e.status) } : sq)),
        );
        return;
      }
      case "context_stats":
      case "usage": {
        const tokens = typeof e.tokens === "number" ? e.tokens : undefined;
        const contextWindow = typeof e.contextWindow === "number" ? e.contextWindow : undefined;
        const messages = typeof e.messages === "number" ? e.messages : undefined;
        setContextStats((prev) => ({
          ...(prev ?? {}),
          ...(tokens != null ? { tokens } : {}),
          ...(contextWindow != null ? { contextWindow } : {}),
          ...(messages != null ? { messages } : {}),
        }));
        return;
      }
      case "session_status":
      case "heartbeats_changed":
      case "extension_error":
        // Not rendered in the chat transcript.
        return;
      default:
        return;
    }
  }, []);

  // ---- Send ----
  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;

      // Set busyRef synchronously BEFORE any work starts so the follow-up
      // flush loop cannot re-enter in the same microtask. In browser demo
      // mode send() returns an already-resolved promise, so its `.finally`
      // would otherwise fire before React re-renders and updates busyRef,
      // draining every queued follow-up at once instead of one at a time.
      busyRef.current = true;

      if (isTauri) {
        setMessages((msgs) => [
          ...msgs,
          { id: `u-${Date.now()}`, role: "user", content: trimmed, timestamp: nowIso(), status: "complete" },
        ]);
        setBusy(true);
        setError(null);
        try {
          await client.prompt(trimmed);
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
          setBusy(false);
        }
        return;
      }

      // Browser demo mode.
      setError(null);
      setMessages((msgs) => [
        ...msgs,
        { id: `u-${Date.now()}`, role: "user", content: trimmed, timestamp: nowIso(), status: "complete" },
      ]);
      setBusy(true);
      simCleanup.current?.();
      simCleanup.current = simulateResponse(trimmed, {
        onUpdate: (updater) => setMessages(updater),
        onDone: () => {
          setBusy(false);
          streamingId.current = null;
        },
      });
    },
    [busy, client],
  );

  // ---- Steer (Enter while busy — delivered after current tool calls) ----
  const steer = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      setSteered({ text: trimmed, at: Date.now() });
      if (steeredTimer.current) window.clearTimeout(steeredTimer.current);
      steeredTimer.current = window.setTimeout(() => setSteered(null), 4000);
      try {
        await client.steer(trimmed);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [client],
  );

  // ---- Follow-up queue ----
  const queueFollowUp = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      followUpSeq.current += 1;
      commitFollowUps([...followUpsRef.current, { id: followUpSeq.current, text: trimmed }]);
    },
    [commitFollowUps],
  );

  const clearFollowUps = useCallback(() => {
    commitFollowUps([]);
  }, [commitFollowUps]);

  /** Retrieve the most recently queued follow-up back into the editor. */
  const popFollowUp = useCallback((): string | undefined => {
    const list = followUpsRef.current;
    if (list.length === 0) return undefined;
    const last = list[list.length - 1];
    commitFollowUps(list.slice(0, -1));
    return last.text;
  }, [commitFollowUps]);

  // Drain the queued follow-ups one at a time — each is delivered only after
  // the previous unit of work finishes (busy → idle).
  const tryFlushFollowUps = useCallback(() => {
    if (flushingRef.current) return;
    if (busyRef.current) return;
    if (followUpsRef.current.length === 0) return;
    flushingRef.current = true;
    const [first, ...rest] = followUpsRef.current;
    commitFollowUps(rest);
    void send(first.text).finally(() => {
      flushingRef.current = false;
      // If the send was a no-op (e.g. it bounced), retry the rest later; if
      // more work was queued while this one ran, it continues on next idle.
      tryFlushFollowUps();
    });
  }, [send, commitFollowUps]);

  // Flush when local busy clears (demo + Tauri user_message cycles).
  useEffect(() => {
    const wasBusy = busyRef.current;
    busyRef.current = busy;
    if (wasBusy && !busy) tryFlushFollowUps();
  }, [busy, tryFlushFollowUps]);

  // Flush when the daemon reports idle via a snapshot (Tauri authoritative).
  const connState = useConnectionState();
  const daemonIdle = connState.queue?.mode === "idle";
  const prevDaemonIdle = useRef(false);
  useEffect(() => {
    const wasIdle = prevDaemonIdle.current;
    prevDaemonIdle.current = daemonIdle;
    // A real daemon turn completing surfaces as a snapshot queue.mode →
    // "idle" transition (there is no dedicated completion session_event kind
    // wired here). Reconcile local busy so the [busy] effect — which owns the
    // follow-up drain — fires on that transition. Gated on the edge so that
    // dispatching the next follow-up (which flips busy=true) does not
    // immediately re-clear it while the daemon still reports the stale idle
    // snapshot.
    if (daemonIdle && !wasIdle) {
      if (busyRef.current) {
        setBusy(false);
      } else {
        tryFlushFollowUps();
      }
    }
  }, [daemonIdle, tryFlushFollowUps]);

  // ---- Inline side questions (/btw, /side) ----
  const askSideQuestion = useCallback(
    (kind: "btw" | "side", question: string) => {
      const q = question.trim();
      if (!q) return;
      const id = `side-${Date.now()}`;
      setSideQuestions((sqs) => [...sqs, { id, kind, question: q, status: "running", answer: "" }]);
      // Fire the real IPC (a no-op in browser mode) via the dedicated RPC.
      void client.startSideQuestion(q).catch(() => {
        // best-effort — the panel still reflects local state
      });
      // In the browser preview there is no live engine to reply, so simulate a
      // short side turn so the panel is demonstrable without Tauri.
      if (!isTauri) {
        window.setTimeout(() => {
          setSideQuestions((sqs) =>
            sqs.map((sq) =>
              sq.id === id
                ? {
                    ...sq,
                    status: "complete",
                    answer: `Side reply (demo preview) — no live engine connected.\n\nYour side question: “${q}”. In the connected app this opens an inline side conversation that doesn't touch the main session.`,
                  }
                : sq,
            ),
          );
        }, 1300);
      }
    },
    [client],
  );

  const dismissSideQuestion = useCallback((id: string) => {
    setSideQuestions((sqs) => sqs.filter((sq) => sq.id !== id));
  }, []);

  // ---- Session name (/name <arg>) ----
  const setSessionName = useCallback(
    (name: string) => {
      const n = name.trim();
      if (!n) return;
      // Functional arg path: /name <name> is captured in the composer and
      // routed here via the dedicated RPC so the display name can be set.
      void client.setSessionName(n).catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      });
    },
    [client],
  );

  // ---- Shell commands (!cmd / !!cmd) ----
  const runShell = useCallback(
    (command: string, hidden: boolean) => {
      const cmd = command.trim();
      if (!cmd) return;
      setShellNotice({ command: cmd, hidden });
      if (shellTimer.current) window.clearTimeout(shellTimer.current);
      shellTimer.current = window.setTimeout(() => setShellNotice(null), 4000);
      // !cmd  → runCommand("exec", [cmd]); !!cmd → hidden (same IPC, hidden flag
      // isn't carried by the contract, so it's surfaced as a distinct indicator).
      void client.runCommand("exec", [cmd]).catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      });
    },
    [client],
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
    simCleanup.current?.();
    simCleanup.current = null;
    setMessages((msgs) =>
      msgs.map((m) => (m.status === "streaming" ? { ...m, status: "complete" } : m)),
    );
    setBusy(false);
    streamingId.current = null;
  }, [client]);

  return {
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
  };
}
