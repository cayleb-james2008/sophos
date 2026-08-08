# Agents module — verification evidence

Worker: P2 (Agents module). Worktree: `C:\Users\Cayleb\.traycer\worktrees\local__prime-agent-windows__f2eb521c4d\piece-agents` · branch: `piece-agents`.

## Gates

### 1. Build (tsc + vite) — PASS
`npm run build` is clean (84 modules transformed, strict TS). TypeScript strict
(`strict`, `noUnusedLocals`, `noUnusedParameters`) — 0 errors.

### 2. Bridge — N/A
Agent module did not touch `bridge/` (no IPC surface change).

### 3. Browser smoke — PASS
- Dev server from this worktree: `npx vite --port 1422` (HTTP 200, 533ms cold start).
- Full DOM probe + client-side nav to the Agents view + injected `window.error`/
  `unhandledrejection` capture + screenshot (browser-harness / CDP, Chromium).

DOM probe:
```json
{"header":true,"empty":true,"standby":true,"runtime":true,"running":true,"telemetry":true,"nolegend":true}
```
Runtime JS errors: `[]` — 0 errors.

Screenshots:
- `verify/agents-view-smoke.png` — production `dist/` smoke (port 1421).
- `verify/agents-view-dev-smoke.png` — dev-server smoke (port 1422).
- `verify/critic-probe.png` — critic's independent probe.

## Critic round 1 (blind) verdict
- CONTRACT: PASS
- BAR: PASS (2 nits + 1 process note, none blocking)

## Defects fixed (D1, D2)

### D1 — `.ag-railfoot` legend had no CSS → FIXED
Added `.ag-railfoot` rule (flex + gap + padding, matching the `inbox.css` legend
pattern). Re-smoke computed style: `display: flex; gap: 15px; 5 children`.

### D2 — Sidebar unread badge never decremented on read → FIXED
`UnreadProvider` now exposes `useUnreadRefresh()`. `useAgents` calls it after
`markRead` / `markAllRead` / `markAgentRead`, keeping the nav badge in sync
(the IPC contract has no `message_read` event, so the count re-derives from
`listInbox`).

## D3 — Process note (port 1420 staleness) — documented
Port 1420 is occupied by a **pre-existing shared dev server** (PID 69412,
rooted in a different checkout) with many connected browser sessions. A direct
module fetch from it (`/src/views/AgentsView.tsx`) still returns the old stub
("Module pending"), confirming it does not serve this worktree. Per the
"never kill coordinator infrastructure" rule, I did **not** terminate it.

Instead, I verified from this worktree's own dev server on a free port (1422)
and via the production `dist/` on 1421 — both render the new Agents view with
0 runtime errors. Correctness is established two ways over: the shared 1420
server is simply not rooted at this branch.

## What was verified at runtime
- App shell + sidebar + all 6 views render (Chat → Sessions → Agents → Inbox → Settings roundtrip clean).
- Clicking the **Agents** nav mounts the new `AgentsView` (client-side, no page load).
- Graceful empty state: "No agents in range" + "No agent selected" standby
  (real IPC path: `MockIpcClient.listAgents()` returns `[]`; no faked data).
- Live connection state flows through `useConnectionState` → StatusDot + RUNTIME MODEL bar.
- Telemetry strip wired to real `rows.length` / `running` / `totalUnread` from state.
- Composer present with placeholder, `maxLength=2000`, aria-label, ⌘/⌃↵ handler.
- Error banner + Retry when IPC throws.
- IPC contract (`src/ipc/contract.ts`, `src/ipc/client.ts`) untouched — additive only.
