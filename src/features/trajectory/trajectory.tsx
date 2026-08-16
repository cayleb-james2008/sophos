// Trajectory — the append-only session event log (v0.7). DeepSeek Harness's
// central principle: "Every run is traceable. Everything the model sees is
// recorded in an append-only session log … Resume, fork, search, and replay
// all operate on the same event stream."
//
// This store mirrors that principle on the data the bridge already provides:
// every IPC event the app receives is appended (never mutated) to a per-session
// log, persisted locally (capped), and exposed through useTrajectory() so the
// Trajectory panel can search, resume, fork, and replay any session.
//
// Append-only means entries are only ever pushed. The log is a pure record of
// what the app observed — nothing is edited or removed in place.

import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useIpcEvent, useConnectionState } from "../../ipc/client";
import type { IpcEvent } from "../../ipc/contract";
import { decomposeProgram } from "../code/demoTurn";

/** One immutable record in a session's event log. */
export interface TrajectoryEntry {
  /** Stable unique id (seq-based). */
  id: string;
  /** Monotonic sequence within the app session. */
  seq: number;
  /** When the event was observed (ISO). */
  ts: string;
  /** Which session this entry belongs to. */
  sessionId: string;
  /** Coarse kind used for the timeline + filters. "program" is a run_code
   *  program (Code Mode) — recorded alongside its individual tool calls. */
  kind: "prompt" | "thinking" | "tool" | "message" | "state" | "agent" | "refinement" | "system" | "program";
  /** Short human label, e.g. "User prompt". */
  label: string;
  /** One-line summary shown in the list. */
  summary: string;
  /** Full detail (payload JSON or text), expandable in the panel. */
  detail?: string;
  /** Source event type, e.g. "session_event". */
  source?: string;
}

const STORAGE_KEY = "sophos.trajectory.v1";
/** Cap per session to keep localStorage bounded (a run can be long). */
const MAX_ENTRIES_PER_SESSION = 1500;

function readPersisted(): Record<string, TrajectoryEntry[]> {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writePersisted(logs: Record<string, TrajectoryEntry[]>): void {
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
  } catch {
    // Quota/security errors are best-effort — the in-memory log still works.
  }
}

interface TrajectoryContextValue {
  /** All logs, keyed by session id. */
  logs: Record<string, TrajectoryEntry[]>;
  /** Append an explicit record (used for user-initiated actions). */
  record: (sessionId: string, entry: Omit<TrajectoryEntry, "id" | "seq" | "ts" | "sessionId">) => void;
  /** Remove all logs (a "clear" control, not an edit of history entries). */
  clearAll: () => void;
}

const TrajectoryContext = createContext<TrajectoryContextValue | undefined>(undefined);

function summarizeEvent(event: IpcEvent): Omit<TrajectoryEntry, "id" | "seq" | "ts" | "sessionId"> | null {
  switch (event.type) {
    case "session_event": {
      const ev = event.event as Record<string, unknown>;
      const kind = ev?.kind as string | undefined;
      switch (kind) {
        case "user_message":
          return { kind: "prompt", label: "User prompt", summary: String(ev?.text ?? ""), detail: String(ev?.text ?? ""), source: "session_event" };
        case "thinking_delta":
          return { kind: "thinking", label: "Thinking", summary: String(ev?.thinking ?? "").slice(0, 140), detail: String(ev?.thinking ?? ""), source: "session_event" };
        case "tool_call":
          return { kind: "tool", label: "Tool call", summary: `called ${String(ev?.name ?? "?")}`, detail: typeof ev?.input === "string" ? ev.input : JSON.stringify(ev?.input ?? {}), source: "session_event" };
        case "tool_result":
          return { kind: "tool", label: "Tool result", summary: `result of ${String(ev?.name ?? "?")}`, detail: String(ev?.output ?? ""), source: "session_event" };
        case "run_code": {
          // Code Mode: one program that calls many tools in a single step. The
          // program itself is recorded here; each of its tool calls arrives as
          // its own tool_call/tool_result event and is recorded separately, so
          // the whole run is searchable, resumable, and forkable like any
          // session. The tool count comes from the pure decomposer.
          const program = String(ev?.program ?? "");
          const callCount = program ? decomposeProgram(program).length : 0;
          return {
            kind: "program",
            label: "Code program",
            summary: `run_code — ${callCount} tool call${callCount === 1 ? "" : "s"}`,
            detail: program || JSON.stringify(ev ?? {}),
            source: "session_event",
          };
        }
        case "run_complete":
          return { kind: "program", label: "Code program", summary: "run_code complete", detail: JSON.stringify(ev ?? {}), source: "session_event" };
        case "text":
          return { kind: "message", label: "Assistant message", summary: String(ev?.text ?? "").slice(0, 140), detail: String(ev?.text ?? ""), source: "session_event" };
        case "side_question_event":
          return { kind: "prompt", label: "Side question", summary: String(ev?.text ?? "").slice(0, 120), detail: JSON.stringify(ev), source: "session_event" };
        case "session_created":
          return { kind: "system", label: "Session created", summary: String(ev?.sessionId ?? ev?.id ?? "new session"), detail: JSON.stringify(ev), source: "session_event" };
        default:
          return { kind: "state", label: `Session event (${kind ?? "?"})`, summary: JSON.stringify(ev ?? {}).slice(0, 120), detail: JSON.stringify(ev ?? {}), source: "session_event" };
      }
    }
    case "agent_watch":
      return { kind: "agent", label: "Agent watch", summary: `${event.event.kind} ${event.event.childId}`, detail: JSON.stringify(event.event), source: "agent_watch" };
    case "agent_message":
      return { kind: "agent", label: "Agent message", summary: `${event.message.fromAgentName ?? event.message.fromAgentId} → ${event.message.toAgentName ?? event.message.toAgentId}: ${event.message.text.slice(0, 120)}`, detail: event.message.text, source: "agent_message" };
    case "refinement_result":
      return { kind: "refinement", label: "Refinement", summary: event.result?.summary ?? "refinement proposed", detail: JSON.stringify(event.result), source: "refinement_result" };
    case "connection_status":
      return { kind: "state", label: "Connection", summary: event.status.kind, detail: JSON.stringify(event.status), source: "connection_status" };
    case "snapshot":
    case "resynced":
      return { kind: "state", label: event.type === "snapshot" ? "Snapshot" : "Resync", summary: `queue ${event.state.queue?.mode ?? "—"}`, detail: JSON.stringify({ activeSessionId: event.state.activeSessionId, queue: event.state.queue, model: event.state.model }), source: event.type };
    default:
      return null;
  }
}

export function TrajectoryProvider({ children }: { children: React.ReactNode }) {
  const seq = useRef(0);
  const [logs, setLogs] = useState<Record<string, TrajectoryEntry[]>>(() => readPersisted());
  const logsRef = useRef(logs);
  logsRef.current = logs;

  // The connection state gives us the active session id for tagging entries.
  const conn = useConnectionState();

  const append = (sessionId: string, partial: Omit<TrajectoryEntry, "id" | "seq" | "ts" | "sessionId">) => {
    seq.current += 1;
    const entry: TrajectoryEntry = {
      id: `t-${seq.current}`,
      seq: seq.current,
      ts: new Date().toISOString(),
      sessionId,
      ...partial,
    };
    setLogs((prev) => {
      const list = [...(prev[sessionId] ?? []), entry];
      const next = { ...prev, [sessionId]: list.length > MAX_ENTRIES_PER_SESSION ? list.slice(-MAX_ENTRIES_PER_SESSION) : list };
      writePersisted(next);
      return next;
    });
  };

  const record = (sessionId: string, partial: Omit<TrajectoryEntry, "id" | "seq" | "ts" | "sessionId">) => {
    append(sessionId || "session-unknown", partial);
  };

  const clearAll = () => {
    setLogs({});
    writePersisted({});
  };

  useIpcEvent((event) => {
    const sessionId = conn.activeSessionId ?? "session-unknown";
    const entry = summarizeEvent(event);
    if (entry) append(sessionId, entry);
  });

  // Keep the provider honest about session switches: the first event after a
  // switch is tagged with the new active session because useConnectionState
  // re-renders before the next event lands.
  useEffect(() => {
    if (conn.activeSessionId) {
      logsRef.current = logs;
    }
  }, [conn.activeSessionId, logs]);

  const value = useMemo(() => ({ logs, record, clearAll }), [logs]);
  return <TrajectoryContext.Provider value={value}>{children}</TrajectoryContext.Provider>;
}

export function useTrajectory(): TrajectoryContextValue {
  const ctx = useContext(TrajectoryContext);
  if (!ctx) throw new Error("useTrajectory must be used within <TrajectoryProvider>");
  return ctx;
}

/** The sessions that have a non-empty trajectory log, newest activity first. */
export function trajectorySessions(logs: Record<string, TrajectoryEntry[]>): string[] {
  return Object.entries(logs)
    .filter(([, entries]) => entries.length > 0)
    .map(([id, entries]) => ({ id, last: entries[entries.length - 1].ts }))
    .sort((a, b) => b.last.localeCompare(a.last))
    .map((x) => x.id);
}
