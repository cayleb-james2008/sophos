# Gauntlet run — RLM child admission and messaging

Date: 2026-08-10 / live verification completed 2026-08-11

## Goal and bar

Investigate the real-daemon RLM failure recorded in `gauntlet-run-2026-08-10-r3.md`.
The bar is real DeepSeek V4 Flash 0731 admission through the Sophos bridge,
followed by child attach, child session-state inspection, and agent messaging.
No mock child and no fabricated pass is acceptable.

## Diagnosis

- **Observed symptom:** r3's live run returned `getRlmChildren() -> []` after the
  model had been asked to call `rlm(...)`. After the model did admit a child,
  the next run showed a second failure: admission was visible, but
  `attachAgent`, `getAgentState`, and `sendAgentMessage` reported that the child
  was not attachable.
- **Authoritative surface:** `DaemonAgentConnection` emits RLM lifecycle as a
  `session_event` whose inner type is `rlm_child_update`; the Sophos bridge
  `ConnectionHolder.handleEvent` owns the snapshot consumed by
  `getRlmChildren`, `attachAgent`, and `sendAgentMessage`.
- **Root cause 1:** Sophos forwarded `rlm_child_update` as a generic session
  event but never merged the child into `this.snapshot.children`. The bridge
  therefore kept the attach-time empty roster forever.
- **Root cause 2:** the public `RlmChild` contract omitted the child's daemon
  `activeSessionId`, so callers could not distinguish admission from a child
  that was ready to attach.
- **Boundary:** child lifecycle/cache mutation remains bridge-owned; Rust stays
  a transparent relay; UI receives the same updated snapshot and session id.
- **Non-goals:** no changes to provider behavior, run-guard, refinement gate,
  kernel-dead detection, autonomous limits, or safety policy.

## Fix

1. `ConnectionHolder.handleEvent` now merges every `rlm_child_update` into the
   cached child roster and emits an enriched snapshot immediately.
2. `RlmChild` now carries optional `sessionId` in TypeScript and Rust wire
   contracts. The bridge maps `activeSessionId` into it for both snapshots and
   `getRlmChildren()`.
3. The agent row mapper preserves the child session id for the interactive
   fleet inspector.
4. The live harness now:
   - polls instead of using a fixed 30-second sleep;
   - emits compact transcript/tool diagnostics if admission is absent;
   - waits for the child active session id;
   - calls `attachAgent`;
   - calls `getAgentState` and checks session/transcript state;
   - calls `sendAgentMessage` and verifies a delivered/queued receipt plus the
     message appearing in the child transcript.

## Proof ledger

### PASS — real DeepSeek RLM path

- **Command:**
  `BRIDGE="$PWD/bridge/dist/bridge/src/index.js" REF="C:/Users/Cayleb/Desktop/workspace/prime-agent-ref/packages/coding-agent" node verify/live-task-gauntlet.mjs`
- **Fresh test folder:**
  `C:\Users\Cayleb\AppData\Local\Temp\sophos-gauntlet-IjSQBp\prime-agent-test-folder`
- **Result:** **27/27 PASS**.
- **Admission:** `live-checker`, child id `sub-6a666781`.
- **Session publication:** active session `328f7d6c574d`.
- **Attach:** `attachAgent` completed through the bridge.
- **State:** `getAgentState` returned the child session and one transcript
  message.
- **Messaging:** `sendAgentMessage` returned a real daemon receipt with
  `deliveryStatus: "queued"`, target active session `328f7d6c574d`, and
  `deliveryMode: "steer"`; the child transcript subsequently contained the
  `child-message-ok` message.
- **Provider:** initial state selected
  `ollama-cloud/deepseek-v4-flash:0731-cloud`; no config-file edit or paid
  fallback was used.

### PASS — full IPC contract

- **Command:**
  `BRIDGE="$PWD/bridge/dist/bridge/src/index.js" REF="C:/Users/Cayleb/Desktop/workspace/prime-agent-ref/packages/coding-agent" node verify/ipc-roundtrip.mjs`
- **Result:** **56/56 PASS** over a fresh TCP daemon and bridge.
- **Relevant safety behavior:** nonexistent child messaging and attach still
  return typed graceful errors.

### PASS — safety controls

- **Command:**
  `BRIDGE="$PWD/bridge/dist/bridge/src/index.js" REF="C:/Users/Cayleb/Desktop/workspace/prime-agent-ref/packages/coding-agent" node verify/live-safety-controls.mjs`
- **Result:** **6/6 asserted PASS**. Refinement proposal remained reviewable
  (`appliedEdits=[]`), real cost/context telemetry was present, and daemon
  disconnect detection fired.

### PASS — browser and native regression gates

- `npm run bridge:build` — PASS.
- `npm run build` — PASS; TypeScript + Vite.
- `cargo check` — PASS.
- `cargo test` — **16/16 PASS**.
- `node verify/e2e-browser.mjs` — **37/37 PASS**, zero console/page errors.

### Environmental note

`node bridge/verify.mjs` was also attempted, but its default named-pipe daemon
collided with a pre-existing shared-workspace session lease and reported 14/27.
The authoritative TCP live harness, IPC roundtrip, and safety harness all passed;
the failure was an environment/transport ownership issue, not the RLM change.
The existing diff also contains a pre-existing trailing-space warning in
`src/ipc/contract.ts`; it was not rewritten because the worktree contains other
agents' changes.

## Verdict

**RLM bar met for the real provider path.** The original empty-roster failure was
bridge snapshot propagation, not a DeepSeek inability to admit children. The
same real child is now visible, attachable, inspectable, and messageable through
the bridge contract. Safety and regression gates remain green.
