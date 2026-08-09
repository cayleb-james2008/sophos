# P1 — Agentic Functionality Hardening — Evidence

**Piece:** P1 (Agentic Functionality Hardening) of the Sophos gauntlet run.
**Worker:** gauntlet-agentic worktree, branch `gauntlet-agentic`.
**Date:** 2026-08-09
**Bar weight:** Functionality 40 / Testing 35 / Visual 25. P1 owns **Functionality**.

## What was verified (live daemon)

The daemon (`node <coding-agent>/dist/bundle/cli.js --mode daemon`, TCP-loopback
transport) was started live and the **real bridge sidecar** was spawned against it
exactly as the Rust shell does. Every agentic IPC command was driven through the
bridge's NDJSON stdio surface and its round-trip confirmed. Harness:
`verify/ipc-roundtrip.mjs` (50 checks, all PASS).

| Feature | Command(s) | Live result |
| --- | --- | --- |
| Goals | `getState` (goals), `prompt("/goal …")` | goals map from daemon GoalState; `newSession(cwd,goal)` sets an active goal |
| Autonomous mode | `prompt("/autonomous on\|off")` | routed through prompt system; `autonomousConfig` graceful-undefined on live path (daemon lacks a read) |
| Heartbeats | `setHeartbeat`, `removeHeartbeat` | round-trip; daemon models as cron jobs |
| Schedules | `addSchedule`, `removeSchedule` | round-trip; daemon `addCronJob`/`cancelCronJob` |
| Refine | `refine`, `refinement_result` event | round-trip; `refine_complete`/`refine_failed` → `refinement_result` event |
| Agents / inbox | `listAgents`, `listInbox`, `sendAgentMessage`, `markMessageRead`, `attachAgent` | round-trip; graceful `-32602` for unknown agent |
| RLM children | `getRlmChildren` | round-trip from snapshot children |
| Side questions | `sideQuestion`, `startSideQuestion` | round-trip; daemon rejects a 2nd concurrent side question gracefully |
| Context tree | `getContextTree`, `getSessionTree`, `navigateTree` | round-trip; `navigateTree` rejects unknown entry gracefully |
| Steering | `steer` | round-trip |
| Follow-up queue | `prompt` + snapshot `queue.mode` idle transition | frontend drains queue on busy→idle (useChat) |
| Compaction | `compact` | round-trip; daemon rejects too-short session with clear message |
| Sessions | `listSessions`, `switchSession`, `resumeSession`, `newSession`, `forkSession`, `cloneSession`, `nameSession`, `setSessionName`, `exportSession`/`exportToHtml`/`exportToJsonl` | all round-trip |
| Models/providers | `getModels`, `getProviders`, `setModel`, `login`, `logout` | round-trip; login/logout mirror to `~/.prime/agent/auth.json` |
| Transport | `runCommand`, `abort`, `getContextStats`, `getSettings`, `setSettings` | round-trip |

**Documented daemon limitations (graceful, not hard-fail):**
- `shareSession` → `-32601` "not yet supported by the daemon" (bridge throws methodNotFound; UI must disable/explain).
- `cloneSession` → falls back to a fork of the most recent user message; only throws `-32601` when there is no forkable point (empty session).

## What was fixed (broken wiring found)

1. **`forkSession` was broken** — the bridge resolved the fork point to the
   session-tree **leaf** (an assistant reply), which the daemon rejects with
   "Invalid entry ID for forking". The frontend also passes **transcript message
   ids** (`msg-N`, synthetic indices) that never matched tree entry ids.
   - Fix: added `ConnectionHolder.resolveForkEntryId()` which uses the daemon's
     `getUserMessagesForForking()` to resolve a request to a **valid user-message
     entry id**. Maps `msg-N` → the Nth user message's fork point; verifies direct
     entry ids against the forkable set; resolves session ids/paths to the most
     recent user message. `forkSession` and `cloneSession` now use it.
   - Verified live: `forkSession({pathOrId:"msg-0"})` → `{cancelled:false, selectedText:"…"}`;
     `cloneSession` on a session with a user message → `{activeSessionId}`.

2. **`newSession(cwd, goal)` re-attach failed** — `createSessionWithConfig()`
   disposed the AgentConnection (created with `closeClientOnDispose: true`), which
   **closed the DaemonClient**, then re-attached with the closed client →
   "Cannot send daemon command 'attach' because the Prime Agent daemon is not
   connected."
   - Fix: after `disposeConnectionOnly()`, reconnect the client
     (`if (!client.isConnected) await client.connect()`) before re-attaching.
   - Verified live: `newSession({cwd, goal})` → `{cancelled:false, activeSessionId}`,
     goal active, status connected.

## Edge cases handled (frontend)

Reviewed every feature component that consumes the agentic IPC. All degrade
gracefully (clear message / disabled action / explained) rather than hard-failing:

- **Empty state** — GoalsPanel, SchedulesPanel, HeartbeatsPanel, RefinementHistory,
  SessionTree, SessionsView, InboxView, AdvancedPanel all render a clear empty
  state ("No active goals", "No schedules", etc.).
- **Error state** — `useActionError` + `ActionErrorBanner` (longrunning/goals);
  per-view error banners with Retry (SessionsView, InboxView, SessionTree,
  SessionDetail, useAgents).
- **Daemon disconnected** — `DaemonStatusBanner` (plain-English reason + TCP
  fallback toggle); SessionsView daemon-down banner + disables New session;
  EnginePanel browser-preview state disables Restart/Stop.
- **Concurrent operations** — busy flags disable buttons; side-question concurrent
  rejection surfaces as a graceful daemon error; follow-up queue drains one at a
  time on busy→idle.
- **Invalid input** — empty inputs disable Add/Set buttons; `prompt` missing text
  → `-32602`; unknown method → `-32601`.
- **Documented-unsupported** — `shareSession`/`cloneSession` return `-32601`; the
  bridge never hard-fails.

## Contract integrity

- `src/ipc/contract.ts` **not modified** (single source of truth preserved).
- All 44 `IpcCommand` methods have a bridge dispatch case **and** a client send
  method (verified via extraction + diff).
- All `IpcEvent` types emitted by the bridge are consumed by the client.

## Design drift

- Copper: 0 matches in `src/` + `bridge/src/`.
- Old fonts (Space Grotesk / JetBrains Mono / Inter): 0 real matches (only
  `setInterval`/`interactive` false positives).
- Non-zero radius: only `0px` / `50%` / `9999px` (dots/pills) — sharp corners kept.
- `tokens.radius.*` all `0px`.

## Builds

- `npm run build` (frontend, tsc strict + vite): **green**.
- `cd bridge && npm run build` (tsc): **green**.

## Files changed

| File | Change |
| --- | --- |
| `bridge/src/connection.ts` | Added `resolveForkEntryId()`; fixed `createSessionWithConfig()` to reconnect the client before re-attach |
| `bridge/src/rpc.ts` | `forkSession` + `cloneSession` now resolve to a valid user-message fork point |
| `package-lock.json` | Rebrand name fix (`prime-agent-windows` → `sophos`) applied by `npm install` |
| `verify/ipc-roundtrip.mjs` | New live round-trip harness (50 checks) |

## Still unverified / needs a live run

- **Named-pipe transport** — all live runs used the TCP-loopback fallback
  (`PRIME_DAEMON_TCP=1`). The named-pipe path (`\\.\pipe\prime-agent-daemon`) is
  structurally identical (same `DaemonClient`/`DaemonAgentConnection`), but was
  not exercised live in this environment. The bridge's `defaultDaemonSocketPath()`
  resolves the same way for both; only the transport differs.
- **Autonomous mode end-to-end** — `autonomousConfig` is graceful-undefined on the
  live path because the daemon exposes autonomous state only via a blocking
  `waitForHeadlessCompletion()` (no read). The UI routes `/autonomous on|off`
  through the prompt system (verified round-trip), but the live active-state read
  is a documented daemon-capability gap (pre-existing, not introduced here).
- **RLM subagent spawn** — `getRlmChildren`/`listAgents` return empty on a fresh
  session (no subagents spawned). The mapping is verified structurally; a live
  multi-agent run would exercise the populated path.

## Self-verdict

**Contract: PASS.** All agentic features round-trip against the live daemon (or
degrade gracefully where the daemon lacks the feature). Two genuine wiring bugs
(fork resolution, newSession re-attach) were found and fixed with live verification.
Build green, contract not drifted, no design drift, no daemon/browser left running.
