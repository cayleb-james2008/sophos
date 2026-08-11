# Gauntlet run — Sophos live daemon/Tauri harness — 2026-08-10

## Status

**GREEN for the verified surfaces; one long-horizon RLM admission remains UNVERIFIED.**

Goal: live-test Sophos against the free `ollama-cloud/deepseek-v4-flash:0731-cloud` model, exercise short and long horizon capabilities, harden the Tauri/bridge contract, and keep the safety/browser gates green.

Bar: real daemon + real bridge, not browser mock; the browser suite remains 37/37; no paid model; no safety-control regression.

## Diagnosis gate

- **Symptom:** the harness UI exposed skills as editable paths only, did not surface the daemon's persistent IPython capability, and scheduled/heartbeat panels could open empty despite live daemon state. Prompt options could not request the daemon's steer/follow-up queue policy through IPC.
- **Authoritative surfaces:** `AgentConnection.getResourceSnapshot()`, `AgentConnectionState.activeToolNames`, `ConnectionState.schedules/heartbeats`, and the bridge `prompt` dispatcher.
- **Reproduction:** connect the real bridge over TCP, call `getRuntimeInfo`/`getState`, create a schedule or heartbeat, then open the corresponding Settings tab; send a prompt while a turn is still active with a queue policy.
- **Boundary:** React panels → Tauri IPC → Rust transparent relay → Node bridge → `DaemonAgentConnection`.
- **Unknowns:** the daemon does not expose a separate IPython liveness RPC; `configured` is therefore not reported as `running`. RLM child admission also depends on the model actually invoking `rlm(...)`.
- **Non-goals:** no paid provider, no unbounded autonomous run, no daemon fork, no weakening of run-guard/refinement/kernel safety controls.
- **Acceptance evidence:** live resource snapshot returns IPython + skills; schedules/heartbeats hydrate from live state; queued prompt options round-trip; 37 browser tests and native safety tests pass.

## Piece map

1. **Runtime capability wiring:** add live `getRuntimeInfo`, exposing IPython capability and daemon-discovered skills/diagnostics.
2. **Long-running state hydration:** hydrate schedules and heartbeats from live `ConnectionState` when Settings opens or the session changes.
3. **Prompt queue contract:** preserve `streamingBehavior`/`queueIfBusy` instead of silently converting any prompt to follow-up.
4. **Harness verification:** bounded live task runner for shell, model-driven file edit, Python, schedule, heartbeat, goal, RLM, and autonomous toggles.
5. **Tauri/native gate:** compile/test the Rust shell and launch the release binary to confirm the daemon + bridge children are spawned without a console window.

## Changes in this run

- `src/ipc/contract.ts`, `src/ipc/client.ts`, `bridge/src/rpc.ts`, `src-tauri/src/contract.rs`: added `getRuntimeInfo`; added prompt queue policy fields.
- `bridge/src/rpc.ts`: maps live resource snapshot + `activeToolNames`; does not overclaim kernel liveness.
- `src/features/settings/SkillsPanel.tsx`: renders live discovered skills, source paths, and diagnostics.
- `src/features/settings/AdvancedPanel.tsx`: surfaces persistent IPython capability and its honest configured/browser-preview/unavailable state.
- `src/features/longrunning/SchedulesPanel.tsx` and `HeartbeatsPanel.tsx`: hydrate from daemon snapshots.
- `src/features/longrunning/AutonomousPanel.tsx`: removed editable-but-unwired budget inputs; active daemon budget is clearly read-only.
- `verify/live-task-gauntlet.mjs`: bounded repeatable live task harness.

## Proof ledger

| Claim | Command / source | Result | Freshness |
|---|---|---|---|
| Frontend build | `npm run build` | GREEN | 2026-08-10, current worktree |
| Bridge typecheck/build | `npm run bridge:build` | GREEN | 2026-08-10, current worktree |
| Native unit gate | `cargo test` | GREEN, 16/16 | 2026-08-10, current worktree |
| Native compile | `cargo check` | GREEN, warnings only for pre-existing unused contract enum | 2026-08-10 |
| Browser safety/UX suite | `node verify/e2e-browser.mjs` | **GREEN, 37/37, 0 failures** | 2026-08-10; generated `verify/e2e/e2e-report.json` |
| IPC contract against real daemon | `BRIDGE=... node verify/ipc-roundtrip.mjs` | **GREEN, 56/56** | 2026-08-10; DeepSeek model reported by daemon |
| Live safety controls | `BRIDGE=... node verify/live-safety-controls.mjs` | **GREEN, 6/6 asserted**; 5 informational | 2026-08-10; real refine proposal, real disconnect |
| Runtime capability wiring | bounded live probe calling `getRuntimeInfo` | **GREEN**: configured/persistent IPython, 434 skills, 8 diagnostics, 1 extension | 2026-08-10 |
| Short + long task harness | `BRIDGE=... node verify/live-task-gauntlet.mjs` | **11/12**: shell, model file edit, Python, schedule, heartbeat, goal, autonomous pass; RLM child not admitted | 2026-08-10; test folder under `%TEMP%\sophos-gauntlet-F60upE` |
| Tauri stack bootstrap | release binary smoke launch | **GREEN**: Tauri PID remained alive 12s; spawned WebView2 + 2 Node children; process tree was terminated by harness | 2026-08-10 |
| Packaged installer | `npm run tauri build` | **UNVERIFIED/BLOCKED**: command exceeded 600s while staging the large bundled runtime; release binary itself exists and launched | 2026-08-10 |

## Remaining ticket with evidence

### RLM-2026-08-10 — real model did not admit a child

- **Repro:** the live harness asks DeepSeek to execute `handle = await rlm("Inspect README.md and return one sentence", name="live-checker")`, waits 30 seconds, then calls `getRlmChildren`.
- **Observed:** `getRlmChildren` returned a real array with `children=0`; the bridge itself was connected and `getRuntimeInfo` reported a persistent IPython capability.
- **Impact:** RLM child admission and subsequent agent messaging/attach cannot be called GREEN from this run. The panel/IPC wiring is present and empty/error states are honest, but the model-driven spawn path needs a deterministic live fixture or a follow-up run with transcript capture to distinguish model non-compliance from daemon admission wiring.
- **Safety decision:** do not fake a child, bypass the model, or mark this pass. Keep the empty state and ticket it.
- **Next action:** capture the model's IPython tool transcript for this exact prompt, then either fix the daemon/session bootstrap if `rlm` is unavailable or add a deterministic daemon-backed child fixture for contract verification.

## Safety notes

- The autonomous probe was bounded: `/autonomous on` followed immediately by `/autonomous off`; no runaway continuation was intentionally generated.
- The refinement gate remained human-controlled; the real daemon emitted a refinement proposal with `appliedEdits=[]`.
- No credentials were displayed, no paid provider was used, and no production system/account mutation occurred.
- The browser and daemon harnesses cleaned up their child processes after each run.
