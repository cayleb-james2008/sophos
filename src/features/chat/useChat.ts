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
import type { ContextStats, SessionEvent, ToolCall, TranscriptMessage } from "../../ipc/contract";
import { demoSeed, demoSeedLarge, simulateResponse } from "./demo";
import { setTranscriptMessages } from "./chatBridge";

/**
 * Parse the daemon's message content — a string OR an array of content blocks
 * ({type:"text"|"thinking"|"toolCall"|...}). Returns the flattened text,
 * thinking, and tool calls so the live event handler can render them.
 */
function parseContentBlocks(content: unknown): { text: string; thinking: string; toolCalls: ToolCall[] } {
  let text = "";
  let thinking = "";
  const toolCalls: ToolCall[] = [];
  if (Array.isArray(content)) {
    for (const part of content) {
      if (part && typeof part === "object") {
        const p = part as Record<string, unknown>;
        const type = p.type;
        if (type === "text" && typeof p.text === "string") text += p.text;
        else if (type === "thinking" && typeof p.thinking === "string") thinking += p.thinking;
        else if (type === "toolCall") {
          toolCalls.push({
            id: typeof p.id === "string" ? p.id : `tc-${Date.now()}-${toolCalls.length}`,
            name: typeof p.name === "string" ? p.name : "tool",
            input: typeof p.arguments === "string" ? p.arguments : p.arguments !== undefined ? JSON.stringify(p.arguments) : undefined,
            status: "running" as const,
          });
        }
      }
    }
  } else if (typeof content === "string") {
    text = content;
  }
  return { text, thinking, toolCalls };
}

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

  // ---- Edit-and-resend draft ------------------------------------------
  // Holds the user message being edited (index + original text). The composer
  // loads `text` into the editor; on send, `send` branches from `index`.
  const [editDraft, setEditDraft] = useState<{ index: number; text: string } | null>(null);
  const editDraftRef = useRef<{ index: number; text: string } | null>(null);

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

  // A2b: coalesce high-frequency context/usage events. A burst (e.g. the
  // child_usage_attributed flood in #1054) would otherwise trigger a state
  // update per event and lock the UI. We accumulate into a ref and flush at
  // most once per 150ms window, applying the latest values.
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

  // ---- Publish the transcript to the shared bridge so the ⌘K palette can
  // search it without duplicating the chat state engine. ----
  useEffect(() => {
    setTranscriptMessages(messages);
  }, [messages]);

  // ---- Cleanup simulation on unmount ----
  useEffect(() => {
    return () => {
      simCleanup.current?.();
      if (statsTimer.current != null) window.clearTimeout(statsTimer.current);
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
        // The daemon emits `message` as a full snapshot with `message.content`
        // (string | content-block array). Parse it into text/thinking/toolCalls.
        const raw = (e.message as Record<string, unknown> | undefined) ?? e;
        const parsed = parseContentBlocks(raw.content);
        const text = parsed.text;
        setMessages((msgs) => {
          const target = msgs.find((m) => m.id === streamingId.current) ?? [...msgs].reverse().find((m) => m.role === "assistant");
          if (!target) {
            return [
              ...msgs,
              {
                id: `a-${Date.now()}`,
                role: "assistant",
                content: text,
                thinking: parsed.thinking || undefined,
                toolCalls: parsed.toolCalls.length > 0 ? parsed.toolCalls : undefined,
                timestamp: nowIso(),
                status: "streaming",
              },
            ];
          }
          return msgs.map((m) =>
            m.id === target.id
              ? {
                  ...m,
                  // Only set content if the message is new/empty — the daemon
                  // streams text via separate `text` events, so a full `message`
                  // snapshot must not clobber already-streamed content.
                  content: m.content ? m.content : text,
                  thinking: parsed.thinking || m.thinking,
                  toolCalls: parsed.toolCalls.length > 0 ? parsed.toolCalls : m.toolCalls,
                  status: "streaming",
                }
              : m,
          );
        });
        return;
      }
      case "text": {
        // Streaming text delta from the daemon — append to the assistant message.
        const text = typeof e.text === "string" ? e.text : "";
        if (!text) return;
        setMessages((msgs) => {
          const target = msgs.find((m) => m.id === streamingId.current) ?? [...msgs].reverse().find((m) => m.role === "assistant");
          if (!target) {
            return [
              ...msgs,
              { id: `a-${Date.now()}`, role: "assistant", content: text, timestamp: nowIso(), status: "streaming" },
            ];
          }
          return msgs.map((m) =>
            m.id === target.id ? { ...m, content: `${m.content}${text}`, status: "streaming" } : m,
          );
        });
        return;
      }
      case "thinking":
      case "thinking_delta": {
        // The daemon emits `thinking` with a `thinking` field (string).
        const text = typeof e.thinking === "string" ? e.thinking : typeof e.text === "string" ? e.text : "";
        if (!text) return;
        setMessages((msgs) => {
          const target = msgs.find((m) => m.id === streamingId.current) ?? [...msgs].reverse().find((m) => m.role === "assistant");
          if (!target) return msgs;
          return msgs.map((m) =>
            m.id === target.id
              ? { ...m, thinking: kind === "thinking_delta" ? `${m.thinking ?? ""}${text}` : `${m.thinking ?? ""}${text}` }
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
        // Coalesce into the 150ms flush window (A2b).
        pendingStats.current = {
          ...(pendingStats.current ?? {}),
          ...(tokens != null ? { tokens } : {}),
          ...(contextWindow != null ? { contextWindow } : {}),
          ...(messages != null ? { messages } : {}),
        };
        flushStats();
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

  // ---- Edit-and-resend / retry (universal message actions) ------------
  const requestEdit = useCallback((index: number, text: string) => {
    const draft = { index, text };
    editDraftRef.current = draft;
    setEditDraft(draft);
  }, []);

  const editAndResend = useCallback(
    (index: number, newText: string) => {
      const trimmed = newText.trim();
      if (!trimmed) return;
      // Branch: keep history up to and including the edited message, replace it
      // with the edited version, and drop everything after. History before the
      // edited message is never mutated.
      busyRef.current = true;
      setMessages((msgs) => [
        ...msgs.slice(0, index),
        { id: `u-${Date.now()}`, role: "user", content: trimmed, timestamp: nowIso(), status: "complete" },
      ]);
      setBusy(true);
      setError(null);
      if (isTauri) {
        void client.prompt(trimmed).catch((err) => {
          setError(err instanceof Error ? err.message : String(err));
          setBusy(false);
        });
        return;
      }
      // Browser demo mode — re-stream a simulated response to the edited text.
      simCleanup.current?.();
      simCleanup.current = simulateResponse(trimmed, {
        onUpdate: (updater) => setMessages(updater),
        onDone: () => {
          setBusy(false);
          streamingId.current = null;
        },
      });
    },
    [client],
  );

  const retry = useCallback(
    (message: TranscriptMessage) => {
      const idx = messages.findIndex((m) => m.id === message.id);
      if (idx < 0) return;
      // Re-issue the preceding user prompt.
      let userText: string | null = null;
      for (let i = idx - 1; i >= 0; i--) {
        if (messages[i].role === "user") {
          userText = messages[i].content;
          break;
        }
      }
      if (!userText) return;
      if (isTauri) {
        void client.retry().catch((err) => {
          setError(err instanceof Error ? err.message : String(err));
        });
        return;
      }
      // Browser demo mode — re-stream a simulated response to that prompt.
      setError(null);
      setBusy(true);
      simCleanup.current?.();
      simCleanup.current = simulateResponse(userText, {
        onUpdate: (updater) => setMessages(updater),
        onDone: () => {
          setBusy(false);
          streamingId.current = null;
        },
      });
    },
    [messages, client],
  );

  // ---- Send ----
  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;

      // Edit-and-resend: if a user message is pending edit, branch from that
      // point instead of appending a fresh message. History before the edited
      // message is never mutated.
      const pending = editDraftRef.current;
      if (pending) {
        editDraftRef.current = null;
        setEditDraft(null);
        return editAndResend(pending.index, trimmed);
      }

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
    [busy, client, editAndResend],
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

  // ---- Demo: load a large transcript to exercise windowed rendering ----
  const loadDemoMessages = useCallback((count = 500) => {
    setMessages(demoSeedLarge(count));
  }, []);

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
    loadDemoMessages,
    editDraft,
    requestEdit,
    retry,
  };
}
