// useCodeRuns — the run_code program store (v0.7.1).
//
// A run_code program is one program that calls many tools in a single step.
// This store watches both demo simulation paths (IPC session_events in the
// Tauri demo shell, the codeRunBus in the browser preview) and decomposes
// each program into its individual tool calls:
//
//   * run_code event   → a new CodeRun, calls seeded by decomposeProgram
//   * tool_call event  → a running call (attributed by runId)
//   * tool_result event → completes the matching call with its output
//   * run_complete      → the program finished
//
// The pure reducer (applyRunEvent) is exported so tests can drive the exact
// decomposition the UI shows. In the browser preview the events don't flow
// through IPC, so bus-sourced runs are also recorded into the Trajectory log
// here (the Tauri shell path records them automatically via summarizeEvent).

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useIpcEvent, useConnectionState } from "../../ipc/client";
import type { ToolCall } from "../../ipc/contract";
import { useTrajectory, type TrajectoryEntry } from "../trajectory/trajectory";
import { subscribeCodeRunEvents, type CodeRunEvent } from "./codeRunBus";
import { decomposeProgram } from "./demoTurn";

/** One tool call inside a program run (the shape ToolCallCard renders). */
export interface CodeRunCall {
  name: string;
  input?: string;
  output?: string;
  status: ToolCall["status"];
}

/** One run_code program, decomposed into its individual tool calls. */
export interface CodeRun {
  id: string;
  sessionId: string;
  program: string;
  createdAt: string;
  calls: CodeRunCall[];
  status: "running" | "complete" | "error";
}

/** A run event belongs to a run only when BOTH the runId and the sessionId
 * match — the store keeps per-session arrays, and this makes the reducer
 * itself session-safe too (defense in depth). */
function matches(run: CodeRun, event: CodeRunEvent): boolean {
  return run.id === event.runId && run.sessionId === event.sessionId;
}

/** Pure reducer: apply one run event to a session's run list. Deterministic —
 * tests assert the exact decomposition this produces. */
export function applyRunEvent(runs: CodeRun[], event: CodeRunEvent): CodeRun[] {
  switch (event.type) {
    case "run_code": {
      if (!event.program) return runs;
      const calls: CodeRunCall[] = decomposeProgram(event.program).map((call) => ({
        name: call.name,
        input: call.input === undefined ? undefined : typeof call.input === "string" ? call.input : JSON.stringify(call.input),
        status: "running",
      }));
      const run: CodeRun = {
        id: event.runId,
        sessionId: event.sessionId,
        program: event.program,
        createdAt: event.ts,
        calls,
        status: "running",
      };
      return [...runs, run];
    }
    case "tool_call": {
      // A tool_call belongs to the FIRST non-complete call with that name: it
      // updates that call's input (healing a degraded seed) and marks it
      // running. If every call with that name is already complete, this is a
      // NEW call — append it so a program calling the same tool twice shows
      // two individual cards. Names never seen before are appended too.
      return runs.map((run) =>
        matches(run, event)
          ? {
              ...run,
              calls: (() => {
                const index = run.calls.findIndex((c) => c.name === event.name && c.status !== "complete");
                if (index < 0) return [...run.calls, { name: event.name, input: event.input, status: "running" as const }];
                const calls = [...run.calls];
                calls[index] = { ...calls[index], input: event.input ?? calls[index].input, status: "running" as const };
                return calls;
              })(),
            }
          : run,
      );
    }
    case "tool_result": {
      // Complete only the FIRST running call with that name — later calls to
      // the same tool keep their own running/complete lifecycle.
      return runs.map((run) =>
        matches(run, event)
          ? {
              ...run,
              calls: (() => {
                const index = run.calls.findIndex((c) => c.name === event.name && c.status === "running");
                if (index < 0) return run.calls;
                const calls = [...run.calls];
                calls[index] = { ...calls[index], output: event.output, status: "complete" as const };
                return calls;
              })(),
            }
          : run,
      );
    }
    case "run_complete": {
      return runs.map((run) =>
        matches(run, event)
          ? {
              ...run,
              status: "complete" as const,
              calls: run.calls.map((c) => (c.status === "running" ? { ...c, status: "complete" as const } : c)),
            }
          : run,
      );
    }
    default:
      return runs;
  }
}

interface CodeRunsContextValue {
  /** All runs keyed by session id, newest last. */
  runs: Record<string, CodeRun[]>;
  clearSession: (sessionId: string) => void;
}

const CodeRunsContext = createContext<CodeRunsContextValue | undefined>(undefined);

/** Normalize an IPC session event into a CodeRunEvent (or null when the
 * event isn't a code-run event). */
function fromIpcEvent(evt: Record<string, unknown>, sessionId: string): CodeRunEvent | null {
  const kind = evt.kind;
  const ts = new Date().toISOString();
  if (kind === "run_code") {
    const program = typeof evt.program === "string" ? evt.program : "";
    if (!program) return null;
    return { type: "run_code", runId: typeof evt.runId === "string" ? evt.runId : `code-run-${Date.now()}`, sessionId, program, ts };
  }
  if (kind === "run_complete") {
    const runId = typeof evt.runId === "string" ? evt.runId : "";
    if (!runId) return null;
    return { type: "run_complete", runId, sessionId, ts };
  }
  if (kind === "tool_call" || kind === "tool_result") {
    const runId = typeof evt.runId === "string" ? evt.runId : "";
    // Only attribute tool events that belong to a code run (the runId prefix
    // keeps ordinary agent tool calls out of the program decomposition).
    if (!runId.startsWith("code-run")) return null;
    const name = typeof evt.name === "string" ? evt.name : "";
    if (!name) return null;
    if (kind === "tool_call") {
      const input = typeof evt.input === "string" ? evt.input : evt.input !== undefined ? JSON.stringify(evt.input) : undefined;
      return { type: "tool_call", runId, sessionId, name, input, ts };
    }
    const output = typeof evt.output === "string" ? evt.output : evt.output !== undefined ? JSON.stringify(evt.output) : undefined;
    return { type: "tool_result", runId, sessionId, name, output, ts };
  }
  return null;
}

export function CodeRunProvider({ children }: { children: React.ReactNode }) {
  const [runs, setRuns] = useState<Record<string, CodeRun[]>>({});
  const conn = useConnectionState();
  const activeSessionId = conn.activeSessionId ?? "session-unknown";
  const { record } = useTrajectory();

  const apply = useMemo(
    () => (event: CodeRunEvent, fromBus: boolean) => {
      setRuns((prev) => {
        const list = prev[event.sessionId] ?? [];
        return { ...prev, [event.sessionId]: applyRunEvent(list, event) };
      });
      // Browser-preview runs never reach the IPC-driven TrajectoryProvider,
      // so record them here; Tauri-shell runs are summarized from the raw
      // events automatically and must NOT be double-recorded.
      if (fromBus) {
        recordTrajectory(record, event);
      }
    },
    [record],
  );

  // IPC path — Tauri demo shell (and any future live event stream).
  useIpcEvent((event) => {
    if (event.type !== "session_event") return;
    const codeEvent = fromIpcEvent(event.event as Record<string, unknown>, activeSessionId);
    if (codeEvent) apply(codeEvent, false);
  });

  // Bus path — browser preview simulation. Bus events don't know the active
  // session, so they're attributed to whatever session is active right now
  // (same as the IPC path, where events land on the current session).
  useEffect(() => {
    return subscribeCodeRunEvents((event) => apply({ ...event, sessionId: activeSessionId }, true));
  }, [apply, activeSessionId]);

  const value = useMemo<CodeRunsContextValue>(
    () => ({
      runs,
      clearSession: (sessionId: string) => setRuns((prev) => {
        const next = { ...prev };
        delete next[sessionId];
        return next;
      }),
    }),
    [runs],
  );

  return <CodeRunsContext.Provider value={value}>{children}</CodeRunsContext.Provider>;
}

type TrajectoryPartial = Omit<TrajectoryEntry, "id" | "seq" | "ts" | "sessionId">;

function recordTrajectory(record: (sessionId: string, entry: TrajectoryPartial) => void, event: CodeRunEvent): void {
  switch (event.type) {
    case "run_code": {
      const count = decomposeProgram(event.program).length;
      record(event.sessionId, { kind: "program", label: "Code program", summary: `run_code — ${count} tool call${count === 1 ? "" : "s"}`, detail: event.program, source: "code-run" });
      break;
    }
    case "tool_call":
      record(event.sessionId, { kind: "tool", label: "Tool call (code)", summary: `called ${event.name}`, detail: event.input ?? "", source: "code-run" });
      break;
    case "tool_result":
      record(event.sessionId, { kind: "tool", label: "Tool result (code)", summary: `result of ${event.name}`, detail: event.output ?? "", source: "code-run" });
      break;
    case "run_complete":
      record(event.sessionId, { kind: "program", label: "Code program", summary: "run_code complete", detail: event.runId, source: "code-run" });
      break;
  }
}

export function useCodeRuns(): CodeRunsContextValue {
  const ctx = useContext(CodeRunsContext);
  if (!ctx) throw new Error("useCodeRuns must be used within <CodeRunProvider>");
  return ctx;
}
