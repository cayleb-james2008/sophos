# Gauntlet run — Sophos harness surface expansion

Date: 2026-08-10/11

## Goal

Enhance Sophos beyond the upstream TUI with a visible persistent IPython notebook, UI-managed skills, continual-harness state, and interactive agent-fleet session inspection without weakening existing safety controls.

## Diagnosis

- Symptom: Sophos exposed IPython only as a capability card, skills only as discovery/path configuration, refinement history only as client-gated proposals, and child nodes lacked a session-state inspector.
- Authoritative surfaces: `AgentConnection.getMessages()`, `getState()`, `getResourceSnapshot()`, daemon-owned `harness_state.json` / `refinements.jsonl`, `watchSession()`, and the Tauri IPC contract.
- Reproduction: connect the real bridge over loopback, request the new state RPCs, create/install a skill in a disposable project, execute an IPython-backed task, and select a child node.
- Non-goals: no paid provider, no unbounded autonomous run, no safety-gate bypass, no production filesystem writes. The live harness used a temporary project folder.

## Implementation

- Added real `getKernelState`, `getHarnessState`, and `getAgentState` IPC commands across TypeScript, Rust, bridge, and daemon adapters.
- Kernel state is derived from real daemon transcript/tool messages: executed cells, outputs/errors, status, assigned names, and imports.
- Added `KernelPanel` with code-cell submission, variables/imports, cell history, outputs, and honest browser-preview/unavailable states.
- Added `createSkill` and `installSkill` commands. Creation writes a real `SKILL.md` under the disposable project's `.prime/agent/skills` path, persists the resource path, reloads the daemon resource loader, and returns the discovered resource.
- Added create/install controls to `SkillsPanel`.
- Added `HarnessStatePanel` with live memory/prompt/skill/subagent entries, local/global scope, versions, source paths, refinement history, and daemon-routed rollback requests. The existing refinement gate remains authoritative.
- Added child session state retrieval via `watchSession`; the agent inspector now shows child activity, token/tool counts, and recent transcript messages when a real child exists.
- Added bounded live harness checks for the new state and skill-management surfaces.

## Verification ledger

| Claim | Command / source | Result |
|---|---|---|
| Frontend typecheck + production build | `npm run build` | PASS; `tsc` and Vite build completed |
| Bridge typecheck/build | `npm run bridge:build` | PASS |
| Rust native tests | `cargo test` | PASS; 16/16 |
| Browser regression suite | `node verify/e2e-browser.mjs` | PASS; 37/37, zero console/page errors |
| Real daemon IPython capability | `verify/live-task-gauntlet.mjs` | PASS; persistent/toolAvailable configured |
| Real kernel state RPC | same harness | PASS; notebook shape returned, executed cell observed |
| Real skill creation/install | same harness | PASS; real SKILL.md created and resource count rose 434 → 435 after reload |
| Harness state RPC | same harness | PASS; real arrays returned; disposable session had 0 entries / 0 history |
| Agent state safety | same harness | PASS; nonexistent child returned -32602 safely |
| Shell/file/Python tasks | same harness | PASS; shell file, model-driven file, and Python artifact completed |
| Schedule/heartbeat/goal/autonomous bounded paths | same harness | PASS; schedule, heartbeat, goal admission, bounded autonomous on→off |

## Unverified / blocker

- RLM child admission remains unproven against DeepSeek in the bounded live run: `getRlmChildren` returned a real empty array (`17/18` harness checks; the only failure). Therefore a real child transcript, attach flow, and child-to-child messaging could not be proven in this run. The code path is wired and nonexistent-agent handling is verified, but this is not a claim of live child success.
- Continual-harness entries and rollback history were structurally returned from the real daemon, but the disposable session had no learned entries. The panel is honest about an empty state; populated-state visual/live evidence still requires a successful real `rlm.harness.create_*` or `/refine` pass.
- Full NSIS/MSI packaging remains outside this run; the previous native release smoke result stands, while full installer packaging had exceeded the watchdog window.

## Safety preservation

No changes were made to run-guard, kernel-dead detection, autonomous limits, or the human refinement gate. The existing browser suite remained green, and live runs used only the free DeepSeek Ollama Cloud model with bounded prompts and immediate autonomous off.
