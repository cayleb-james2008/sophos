// useRunGuard — client-side reliability guardrails for long-running work (A2).
//
// Research D28–D36 + D36b: goal mode looping forever (#986), idle prompt
// starvation (#1000), usage-attribution floods (#1054), compaction self-
// amplification (#900), and the #764 runaway — 873 assistant turns, 694 goal
// continuations, 176M tokens, $272.39 billed against a dead kernel over ~9.5h.
// Sophos can't fix the daemon, but the desktop client must make these visible
// and recoverable instead of silently hanging.
//
// This hook derives two guardrails from the EXISTING IPC contract (no new
// methods — the contract is frozen):
//
//   (e1) Dead-engine detection — when the connection status reports the engine
//        down/reconnecting while a goal or autonomous mode is active, surface
//        it prominently. Honest label: this reflects the connection status the
//        daemon reports; the contract does not expose kernel liveness
//        separately, so we never claim to know the kernel is dead.
//
//   (e2) Spend/iteration circuit-breaker — a fully client-side budget (max
//        cost, max tokens, max iterations) that trips when exceeded while a
//        goal or autonomous loop is active. The daemon's own limits
//        (autonomousConfig.maxTurns / maxTokens) seed the defaults. When it
//        trips, the UI surfaces a "budget reached" state with pause/stop
//        recovery actions. Auto-halting the loop would require a contract
//        change, so the breaker makes the runaway visible and gives a one-click
//        recovery instead — the honest client-side answer to a $272 runaway.

import { useState } from "react";
import { useConnectionState, useIpcEvent } from "../../ipc/client";

export interface RunGuardState {
  engineDown: boolean;
  budgetTripped: boolean;
  reason: string | null;
  active: boolean;
  goalActive: boolean;
  autoActive: boolean;
  cost: number;
  tokens: number;
  iterations: number;
  maxCost: number;
  maxTokens: number;
  maxIterations: number;
}

/** Client-side default spend cap (USD) for the circuit-breaker. */
export const DEFAULT_MAX_COST = 50;
/** Client-side default token cap when the daemon reports no autonomous limit. */
export const DEFAULT_MAX_TOKENS = 200000;
/** Client-side default iteration cap when the daemon reports no turn limit. */
export const DEFAULT_MAX_ITERATIONS = 20;

export function useRunGuard(): RunGuardState {
  const state = useConnectionState();
  const [iterations, setIterations] = useState(0);

  // Count assistant turns (full `message` snapshots) as a proxy for loop
  // iterations. Honest: this is a client-side count of reported turns, not a
  // daemon continuation counter (the contract does not expose one).
  useIpcEvent((event) => {
    if (event.type === "session_event" && event.event.kind === "message") {
      setIterations((n) => n + 1);
    }
  });

  const goals = state.goals ?? [];
  const goalActive = goals.some((g) => g.status === "active");
  const autoActive = state.autonomousConfig?.active ?? false;
  const active = goalActive || autoActive;

  // (e1) Engine down while a loop is active. Reflects the connection status the
  // daemon reports — not a separate kernel-liveness signal (none exists).
  const engineDown = state.status.kind === "disconnected" || state.status.kind === "reconnecting";

  // (e2) Spend / iteration budget.
  const cost = state.costStats?.totalCost ?? state.costStats?.sessionCost ?? 0;
  const tokens =
    state.context?.tokens ?? (state.costStats?.inputTokens ?? 0) + (state.costStats?.outputTokens ?? 0);
  const maxCost = DEFAULT_MAX_COST;
  const maxTokens = state.autonomousConfig?.maxTokens ?? DEFAULT_MAX_TOKENS;
  const maxIterations = state.autonomousConfig?.maxTurns ?? DEFAULT_MAX_ITERATIONS;

  const costTripped = cost >= maxCost;
  const tokenTripped = tokens >= maxTokens;
  const iterTripped = iterations >= maxIterations;
  const budgetTripped = active && (costTripped || tokenTripped || iterTripped);

  const reason = costTripped
    ? `spend $${cost.toFixed(2)} ≥ $${maxCost}`
    : tokenTripped
      ? `tokens ${tokens.toLocaleString()} ≥ ${maxTokens.toLocaleString()}`
      : iterTripped
        ? `iterations ${iterations} ≥ ${maxIterations}`
        : null;

  return {
    engineDown,
    budgetTripped,
    reason,
    active,
    goalActive,
    autoActive,
    cost,
    tokens,
    iterations,
    maxCost,
    maxTokens,
    maxIterations,
  };
}
