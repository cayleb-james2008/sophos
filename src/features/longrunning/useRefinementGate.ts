// useRefinementGate — the shared review-and-approve gate for refinement.
//
// Research D37 / D38 / F17: the single most disqualifying concern for
// security-conscious users is a self-editing loop with no human gate. Sophos
// makes refinement review-and-approve by default: when a `refinement_result`
// event arrives, the proposed change is held as a *pending proposal* and the
// user must explicitly Apply (or Discard) before it is accepted into the
// session's refinement record. "Auto-apply" is an explicit opt-in, OFF by
// default, persisted client-side (a UI preference — the IPC contract is
// frozen and carries no such setting).
//
// The store is a module-level singleton so the always-visible SystemBar
// indicator and the RefinementHistory panel share the same pending/history
// state. A single <RefinementGateProvider /> (mounted in the Shell) owns the
// IPC subscription; components read the store via useRefinementGate().
//
// Honesty note: the daemon applies its own edits (RefinementResult.appliedEdits
// carries an `applied` flag) — the contract has no "propose-only" mode. The
// gate is therefore the user's acceptance decision: the proposed change is
// surfaced and must be explicitly approved before it is recorded as applied,
// and the daemon's own applied/error flags are surfaced verbatim. We never
// invent a value the daemon did not report.

import { useSyncExternalStore } from "react";
import { useIpcEvent } from "../../ipc/client";
import type { RefinementResult } from "../../ipc/contract";
import { diffLines, type DiffLine } from "./diff";

export interface RefinementEntry {
  id: string;
  timestamp: string;
  description: string;
  status: "applied" | "discarded" | "rolled-back";
  result?: RefinementResult;
}

export interface PendingRefinement {
  result: RefinementResult;
  receivedAt: string;
  /** Rendered diff lines for the banner — computed from the event, never fabricated. */
  diff?: DiffLine[];
}

/**
 * Widened edit shape. The frozen IPC contract carries no old/new file content,
 * but a richer event (e.g. the demo trigger) may include it. We read it
 * defensively and only ever render what the event actually reported.
 */
type AppliedEdit = NonNullable<RefinementResult["appliedEdits"]>[number];
interface RichEdit extends AppliedEdit {
  path?: string;
  oldContent?: string;
  newContent?: string;
}

/**
 * Build the diff shown in the banner from a refinement result.
 *
 * Honesty: the frozen contract does not carry old/new file content, so a true
 * unified diff is only rendered when the event actually includes it
 * (oldContent/newContent on an edit). Otherwise we fall back to a structured
 * per-edit change list (file + action + kind) — we never invent content the
 * daemon did not report.
 */
export function buildRefinementDiff(result: RefinementResult): DiffLine[] {
  const edits = (result.appliedEdits ?? []) as RichEdit[];
  const rich = edits.filter((e) => e.oldContent != null || e.newContent != null);
  if (rich.length > 0) {
    const lines: DiffLine[] = [];
    for (const e of rich) {
      const path = e.path ?? e.title ?? e.action ?? "edit";
      lines.push({ type: "ctx", text: `@@ ${path} @@` });
      lines.push(...diffLines(e.oldContent ?? "", e.newContent ?? ""));
    }
    return lines;
  }
  const lines: DiffLine[] = [];
  for (const e of edits) {
    const title = e.title ?? e.action ?? e.kind ?? "edit";
    lines.push({ type: "ctx", text: `@@ ${title} @@` });
    if (e.action) lines.push({ type: "del", text: e.action });
    if (e.kind) lines.push({ type: "add", text: e.kind });
  }
  return lines;
}

interface GateState {
  pending: PendingRefinement | null;
  history: RefinementEntry[];
  autoApply: boolean;
}

const AUTO_APPLY_KEY = "sophos.refineAutoApply.v1";

function readAutoApply(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(AUTO_APPLY_KEY) === "1";
  } catch {
    return false;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Build a short human description of a refinement result. */
export function describeRefinement(r: RefinementResult): string {
  if (r.summary) return r.summary;
  const edits = r.appliedEdits ?? [];
  if (edits.length > 0) {
    const titles = edits
      .map((e) => e.title ?? e.action ?? e.kind ?? "edit")
      .filter((t): t is string => Boolean(t));
    if (titles.length) return `Refined: ${titles.join(", ")}`;
  }
  return "Refinement";
}

let state: GateState = {
  pending: null,
  history: [],
  autoApply: readAutoApply(),
};

const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function setState(patch: Partial<GateState>) {
  state = { ...state, ...patch };
  emit();
}

function addHistory(entry: RefinementEntry) {
  setState({ history: [entry, ...state.history] });
}

/** Handle an incoming refinement_result event (called by the provider). */
export function handleRefinementResult(result: RefinementResult) {
  if (result.error) {
    // A failed pass — record it honestly as a discarded/errored entry so the
    // user sees the daemon reported a failure, not a silent no-op.
    addHistory({
      id: result.id ?? `refine-${Date.now()}`,
      timestamp: nowIso(),
      description: result.error,
      status: "discarded",
      result,
    });
    return;
  }
  if (state.autoApply) {
    addHistory({
      id: result.id ?? `refine-${Date.now()}`,
      timestamp: nowIso(),
      description: describeRefinement(result),
      status: "applied",
      result,
    });
  } else {
    setState({ pending: { result, receivedAt: nowIso(), diff: buildRefinementDiff(result) } });
  }
}

function applyPending() {
  if (!state.pending) return;
  const { result, receivedAt } = state.pending;
  addHistory({
    id: result.id ?? `refine-${Date.now()}`,
    timestamp: receivedAt,
    description: describeRefinement(result),
    status: "applied",
    result,
  });
  setState({ pending: null });
}

function discardPending() {
  if (!state.pending) return;
  const { result, receivedAt } = state.pending;
  addHistory({
    id: result.id ?? `refine-${Date.now()}`,
    timestamp: receivedAt,
    description: describeRefinement(result),
    status: "discarded",
    result,
  });
  setState({ pending: null });
}

function setAutoApply(value: boolean) {
  setState({ autoApply: value });
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(AUTO_APPLY_KEY, value ? "1" : "0");
    }
  } catch {
    // best-effort persistence
  }
}

/** Mark a history entry as rolled back (via /refine rollback <id>). */
export function markRolledBack(id: string) {
  setState({
    history: state.history.map((h) => (h.id === id ? { ...h, status: "rolled-back" as const } : h)),
  });
}

/**
 * Read the shared refinement gate. Returns stable functions; the snapshot is
 * the module-level store so all consumers stay in sync.
 */
export function useRefinementGate() {
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
  return {
    pending: state.pending,
    history: state.history,
    autoApply: state.autoApply,
    apply: applyPending,
    discard: discardPending,
    setAutoApply,
  };
}

/**
 * Mount once (in the Shell) to own the refinement_result IPC subscription and
 * feed the shared store. Renders nothing.
 */
export function RefinementGateProvider() {
  useIpcEvent((event) => {
    if (event.type === "refinement_result") {
      handleRefinementResult(event.result);
    }
  });
  return null;
}
