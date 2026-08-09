# I2 — Agentic Reliability + Presentation Polish: Evidence

**Worker:** I2 agentic (gauntlet-research-i2-agentic)
**Date:** 2026-08-09
**Branch:** `gauntlet-research-i2-agentic`
**Scope:** Harden and polish Sophos's agentic surface (long-running / autonomous
features) against the reliability failures and trust concerns real Prime Agent
users reported. Real code, build-green, on-brand.

---

## Verification summary

| Check | Result |
|---|---|
| `npm run build` | ✅ green, 0 TS errors |
| `node verify/e2e-browser.mjs` | ✅ **35/35**, 0 console/page errors |
| `git diff master -- src/ipc/contract.ts` | ✅ empty (contract frozen) |
| Design tokens | ✅ all styling through `tokens.ts`; no copper, no Space Grotesk/Inter/JetBrains Mono, no non-zero radius (except `9999px`/`50%` dots), no glow |
| No invented data | ✅ every value shown comes from the real contract or is honestly labelled as unavailable |

**Commits (author `Cayleb James <106564347+cayleb-james2008@users.noreply.github.com>`):**

| SHA | Change |
|---|---|
| `2353ed8` | A1 — human review-and-approve gate for `/refine` |
| `f575a03` | A2 — long-running reliability guardrails (incl. D36b) |
| `9ce6c6c` | A3 — honest empty/not-running states across agentic views |
| `3eccf5e` | A4 — autonomous/refine budget + opt-in visibility |
| `b717b39` | infra — vite `fs.allow` for junctioned node_modules fonts (e2e 0-console-error gate) |

---

## A1 — Human review-and-approve gate for `/refine` (HIGHEST VALUE)

**Research findings:** D37 ("a self-editing loop with no human gate is how a
system drifts silently"), D38 (kernel runs model-generated code with user
permissions, not a sandbox), F17 (show the refine diff before applying, not
after).

**What changed:**
- `src/features/longrunning/useRefinementGate.ts` (new) — a shared module-level
  store + `RefinementGateProvider` that owns the `refinement_result` IPC
  subscription. When a refinement result arrives it is held as a **pending
  proposal**; the user must explicitly Apply (or Discard) before it is accepted
  into the session's refinement record. Auto-apply is an explicit opt-in, OFF
  by default, persisted client-side (the IPC contract is frozen and carries no
  such field). Failed passes are recorded honestly as discarded/errored.
- `src/features/longrunning/RefinementHistory.tsx` — renders the pending
  proposal (summary, rationale, expected outcome, proposed edits with the
  daemon's own `applied` flags) with **Apply** / **Discard**, an auto-apply
  toggle, a trust note ("not a sandbox"), and the history list with
  applied/discarded/rolled-back statuses + rollback.
- `src/features/longrunning/RefinementGateBanner.tsx` (new) — always-visible
  banner in the Shell so a pending proposal is surfaced from any view.
- `src/shell/Shell.tsx` — mounts the provider + banner.
- `src/ipc/client.ts` — `MockIpcClient.refine()` emits a demo
  `refinement_result` so the gate is demonstrable in the browser preview.

**Honesty note:** the daemon applies its own edits (`RefinementResult.appliedEdits`
carries an `applied` flag); the contract has no "propose-only" mode. The gate is
therefore the user's acceptance decision — the proposed change is surfaced and
must be explicitly approved before it is recorded as applied, and the daemon's
own applied/error flags are surfaced verbatim. We never invent a value the daemon
did not report.

**Verified:** build green; e2e 35/35 (Refinement panel renders, no console
errors); manual probe clicked "Refine now" in the browser preview → pending
proposal appeared with Apply/Discard, no errors.

---

## A2 — Long-running reliability guardrails in the UI

**Research findings:** D28 (goal mode loops forever), D29 (programmatic prompts
starve at idle), D30/#1054 (child-usage-attribution flood freezes the worker),
D34 (heartbeats dropped, no run counter), D36b/#764 (dead kernel + active
goal/heartbeat → 873 turns, 694 goal continuations, 176M tokens, $272.39 billed
over ~9.5h).

**What changed:**
- `src/features/longrunning/useRunGuard.ts` (new) + `RunGuardBanner.tsx` (new) —
  **(e1) dead-engine detection**: when the connection status reports the engine
  down/reconnecting while a goal or autonomous loop is active, surface "Engine
  is down — the loop can't continue" prominently. Honest label: reflects the
  connection status the daemon reports (the contract exposes no separate
  kernel-liveness signal). **(e2) spend/iteration circuit-breaker**: a fully
  client-side budget (max cost $50, max tokens, max iterations) that trips when
  exceeded while a loop is active, with one-click Pause/Stop recovery and a
  "budget reached — resume?" override. Auto-halting the loop would require a
  contract change, so the breaker makes the runaway visible and gives recovery.
- `src/features/longrunning/useStall.ts` (new) — "no progress for N min"
  detector. Wired into `GoalsPanel` and `AutonomousPanel` with Nudge/Stop
  recovery (D28/D29).
- `src/features/chat/useChat.ts` — coalesce high-frequency `context_stats`/
  `usage` events into a 150ms flush window so a burst (the #1054 flood shape)
  can't lock the UI (D30).
- `src/features/longrunning/nextDue.ts` (new) — honest next-run estimate for
  heartbeats/schedules, labelled "(est.)"; last-fired honestly reported as
  "not reported by daemon" (D34). Wired into `HeartbeatsPanel` and
  `SchedulesPanel`.

**Verified:** build green; e2e 35/35; manual probe of the long-running panels
showed no errors. The circuit-breaker and stall detectors are client-side
heuristics derived from the real contract (costStats, context, queue mode,
connection status) — no invented values.

---

## A3 — Honest empty / not-yet-running states across the agentic views

**Research findings:** "unreachable in practice" (D28–D36) + the general UX gap —
upstream users found the agentic features hard to reach/understand.

**What changed** (operator-grade copy explaining what the feature does, what
turns it on, and what to expect):
- `src/features/goals/GoalsPanel.tsx` — "No active goals" now explains a goal is
  a durable objective that persists across turns/detach and keeps prompting.
- `src/features/longrunning/AutonomousPanel.tsx` — explicit "Not running" state:
  opt-in, never acts on its own, SystemBar shows a green AUTO indicator.
- `src/features/longrunning/HeartbeatsPanel.tsx` — "No heartbeats set" explains
  the recurring visible instruction, one active at a time, persists.
- `src/features/longrunning/SchedulesPanel.tsx` — "No schedules" explains
  cron-delivered prompts, persist and continue while detached.
- `src/features/agents/AgentsView.tsx` — "No agents in range" explains the fleet
  graph shows daemon agents + RLM children, appear on connect.
- `src/features/inbox/InboxView.tsx` — "No relay traffic yet" explains the relay
  between you and peers, unread stays highlighted.
- Refinement empty state (A1) already explains the review-and-approve flow.

**Verified:** build green; e2e 35/35 (empty states render, no console errors).

---

## A4 — Autonomous/refine budget + opt-in visibility

**Research findings:** D37–D39, F17 — a user must never be unsure whether the
agent is acting on its own.

**What changed:**
- `src/shell/SystemBar.tsx` — always-visible **AUTO** and **REFINE** indicators
  (terminal green = active signal, per the design tokens). AUTO is green when
  `autonomousConfig.active`, dim when off, with the daemon's active budget in a
  tooltip. REFINE is green when a refinement is pending review (from the shared
  gate store), dim when none.
- `src/features/longrunning/AutonomousPanel.tsx` — wired to the daemon's
  `autonomousConfig` to show the real active budget (turns/tokens/time) and an
  explicit "Not running" opt-in state.
- Refine auto-apply toggle (opt-in, OFF by default) landed in A1.

**Verified:** build green; e2e 35/35 (SystemBar renders, no console errors).

---

## Deliberately NOT done (and why)

- **No IPC contract change.** The contract is frozen. The refine gate, the
  circuit-breaker, the stall detector, and the heartbeat/schedule health are all
  derived from the existing contract (`refinement_result`, `connection_status`,
  `snapshot`, `costStats`, `context`, `autonomousConfig`, `goals`, `schedules`,
  `heartbeats`). A true "propose-only" refine mode or a daemon-reported
  last-fired/next-due timestamp would require a contract change and were
  therefore not attempted — instead the UI degrades honestly (e.g. "last fired:
  not reported by daemon", "(est.)" labels).
- **No auto-halt of a runaway loop.** Halting the daemon's goal/autonomous loop
  automatically would require a contract change. The circuit-breaker makes the
  runaway visible and gives one-click Pause/Stop recovery instead.
- **No `src-tauri/` or `bridge/` changes.**
- **No design-token value changes** (only the vite `fs.allow` infra fix, which
  is not a token).

## Browser hygiene

After the final e2e run, all headless Chrome and the :1420 dev server were
killed and verified via `Get-Process`/`tasklist` — no browser or dev server left
running.
