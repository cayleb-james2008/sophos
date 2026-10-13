# Reliability dispositions — Sophos v0.8.0

This is the record of what v0.8.0 did about each of the five reliability bugs
named in the release bar, mapped from `research/user-feedback-audit.md`. Every
item is either **FIXED** (with the regression test that pins it) or
**REFUTED** (an upstream daemon/bridge contract seam that cannot change this
release, with the evidence). Nothing is left silently open.

The boundary that matters: Sophos owns the React frontend (`src/`), the Node
bridge sidecar (`bridge/`), and the Rust Tauri supervisor (`src-tauri/`). The
agent runtime — the daemon, its goal engine, the persistent IPython kernel, and
the session-lease file format — is the upstream `@earendil-works/pi-coding-agent`
package, vendored at `../prime-agent-ref/packages/coding-agent` and consumed
through the bridge. Sophos deliberately does not patch that package (a patch
would be overwritten on every upstream sync), so where a root cause lives only
in the daemon, the fix is a client-side guard that makes the condition visible
and recoverable, and the root cause is recorded as an upstream seam.

---

## 1. Goal-loop watchdog — FIXED (client) + REFUTED (daemon)

- **Finding:** D28 / upstream #986 — goal mode keeps injecting `goal_context`
  continuations with no actionable work, looping forever after completion.
- **Sophos fix:** a goal-loop watchdog that flags "no progress for N minutes"
  while a goal is active, with one-click Nudge / Pause recovery.
  - `src/features/longrunning/useStall.ts` — the quiet-window detector.
  - `src/features/goals/GoalsPanel.tsx` — the stalled-goal warning + actions
    (trips after 5 minutes of no reported progress).
- **Regression tests:** `src/features/longrunning/__tests__/useStall.test.ts`
  (5 tests: never-flag-when-inactive, flags-after-quiet-window, resets-on-signal,
  identical-signal-no-reset, clears-on-inactive) and
  `src/features/goals/__tests__/GoalsPanel.test.tsx`.
- **REFUTED seam (daemon):** the loop-injection itself lives in the daemon's
  goal/continuation engine. The IPC contract exposes only the goal's
  `objective`/`status`/`progress` — there is no "stop injecting continuations"
  method. The client can only surface and pause (via the existing `/goal pause`
  prompt pipeline); it cannot edit the daemon's loop logic this release.

## 2. Dead-kernel detection — FIXED (client) + REFUTED (daemon)

- **Finding:** D36b / upstream #764 — an unexpected kernel exit leaves the
  session permanently dead and a goal loop bills against the corpse
  (873 turns, 176M tokens, $272.39 over ~9.5h).
- **Sophos fix:** dead-engine detection that surfaces "the loop can't continue"
  the moment the daemon reports the engine down while a goal/autonomous loop is
  active, instead of silently hanging.
  - `src/features/longrunning/useRunGuard.ts` — the `engineDown` guard (e1).
  - `src/features/longrunning/RunGuardBanner.tsx` — the always-visible alert.
  - `bridge/src/connection.ts` — `mapKernelDiagnostic` / `getKernelState`
    already map the daemon's kernel-health reason to an explicit `dead` state
    (`"The Python workspace stopped unexpectedly … Restart the engine"`).
- **Regression tests:** `src/features/longrunning/__tests__/useRunGuard.test.ts`
  (12 tests, including "flags engineDown when disconnected while a goal is
  active" and "does not flag engineDown when disconnected with nothing active").
- **REFUTED seam (daemon):** reprovisioning the kernel (auto-restart) is
  daemon-only — the contract has no `restart_kernel` method; the client can
  only surface the dead state and the engine Restart control
  (`src/features/engine/EnginePanel.tsx`).

## 3. Spend / iteration circuit-breaker — FIXED (client)

- **Finding:** D41 / #1029 / #764 — no guard against degenerate repetition and
  runaway spend ("The the the…" ~2,365 times; the $272.39 continuation loop).
- **Sophos fix:** a client-side circuit-breaker that trips when cost, tokens, or
  iterations exceed a cap while a loop is active, with one-click Pause/Stop and
  an explicit "resume?" override.
  - `src/features/longrunning/useRunGuard.ts` — the budget guard (e2), seeded
    by the daemon's own `autonomousConfig.maxTurns` / `maxTokens`, with client
    defaults (`DEFAULT_MAX_COST` / `DEFAULT_MAX_TOKENS` /
    `DEFAULT_MAX_ITERATIONS`).
  - `src/features/longrunning/RunGuardBanner.tsx` — the "budget reached —
    resume?" banner.
- **Regression tests:** `src/features/longrunning/__tests__/useRunGuard.test.ts`
  (spend trip, token trip, iteration trip, daemon-limit override, inactive
  no-trip, non-message events ignored).
- **Documented limitation:** auto-halting the loop would need a contract change;
  the breaker makes the runaway visible and gives one-click recovery, which is
  the honest client-side answer. This is documented in the `useRunGuard.ts`
  header, not hidden.

## 4. Stale session-lease recovery — FIXED (new in v0.8.0)

- **Finding:** W6 / W10 / D39b — a crashed worker leaves stale
  `~/.prime/agent/session-leases/*.lock` directories; every later resume fails
  with `EPERM` and the daemon cannot self-heal (the upstream `prime-agent doctor
  --fix` reported them as *kept*, not cleared).
- **Sophos fix:** a conservative startup sweep in the Rust supervisor, run
  **before** the daemon spawns:
  - `src-tauri/src/lease.rs` — removes (a) unambiguous crash leftovers
    (`*.lock.stale-*` / `*.lock.candidate-*`) and (b) full `*.lock` lease
    directories only when the `owner.json` PID is provably dead **and** the
    lease is past a 1-hour grace window. Missing/malformed owner data and an
    undeterminable PID liveness both mean **keep** — never delete on
    uncertainty.
  - Wired in `src-tauri/src/lib.rs` (`lease::sweep_stale_leases` in setup).
- **Regression tests:** `src-tauri/src/lease.rs` `#[cfg(test)]` — 6 tests
  (dead+old → stale, inside-grace → keep, live-owner → keep, unknown-owner →
  keep, strict grace boundary, leftover-name recognition). `cargo test` is
  green (25 tests).
- **Defense in depth:** the bundled daemon already reclaims a stale lease on its
  next acquire of the same session
  (`prime-agent-ref/packages/coding-agent/src/core/session-lease.ts`,
  `reclaimStaleLease` + `isLeaseOwnerAlive`). The sweep closes the gap the
  daemon leaves (debris + leases never re-acquired), which is what made a
  crashed Windows host unrecoverable without manual filesystem surgery.
- **Not covered (recorded, not silent):** orphaned `daemon-workers/<key>/`
  descriptors are self-managed by the daemon on startup
  (`daemon-supervisor.ts` `loadWorkerDescriptors` + `adoptOrRecoverWorker`); a
  shell-side sweep there could race a live supervisor, so Sophos does not touch
  them. `docs/WHATS_DIFFERENT.md` previously claimed "clears … orphaned worker
  descriptors at startup" with no backing code; that claim is now corrected.
- **Agent-dir override seam:** the daemon honors a `<PREFIX>_CODING_AGENT_DIR`
  env override for its agent dir (`config.ts` `getAgentDir`). Sophos neither sets
  that override nor reads it, so the sweep targets the same default
  (`~/.prime/agent`) the daemon uses. A host that sets the override manually
  moves the leases out of the swept path — the sweep then finds nothing, which
  is safe (no deletion), but it does not follow the override. Recorded here so
  it is an explicit boundary, not an assumption.

## 5. Console-window recovery — FIXED

- **Finding:** W3 / W7 / W8 / W9 / W12 — spawning a console node process from a
  GUI app flashes/steals focus on launch and per prompt; detached children open
  visible consoles; orphaned process trees survive.
- **Sophos fix:** the Rust supervisor spawns everything headless and guarantees
  children die with the parent:
  - `src-tauri/src/daemon.rs` / `sidecar.rs` — `CREATE_NO_WINDOW` on both
    children.
  - `scripts/no-window-preload.cjs` — injected with `--require` so the daemon's
    **grandchildren** (kernels, shells, tools) default to `windowsHide: true`.
  - `src-tauri/src/job.rs` — a Windows Job Object with
    `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, so every assigned child is terminated
    when the app exits (no orphans on quit or hard kill).
  - `src-tauri/src/sidecar.rs` — generation-guarded EOF recovery, so a crashed
    sidecar restarts without a hot loop and a stale reader can't resurrect an
    old child.
- **Regression tests:** `src-tauri/src/sidecar.rs` `#[cfg(test)]` — EOF-recovery
  invalidation tests (`explicit_restart_invalidates_stale_eof_recovery`,
  `shutdown_invalidates_eof_recovery`), plus the `lease.rs` tests above.
- **REFUTED seam (daemon):** the daemon's own orphan-tree *termination on
  recovery* (W9/W12) is daemon-internal; the Job Object is the shell's answer
  for app-exit orphans, which is the surface a desktop supervisor controls.

---

## Summary

| Bug | Disposition | Test |
|---|---|---|
| Goal-loop watchdog | FIXED (client) / REFUTED (daemon loop) | `useStall.test.ts` + `GoalsPanel.test.tsx` |
| Dead-kernel detection | FIXED (client) / REFUTED (daemon restart) | `useRunGuard.test.ts` |
| Spend/iteration breaker | FIXED (client) | `useRunGuard.test.ts` |
| Stale session-lease recovery | FIXED (new Rust sweep) | `lease.rs` 6 tests |
| Console-window recovery | FIXED | `sidecar.rs` + `lease.rs` tests |
