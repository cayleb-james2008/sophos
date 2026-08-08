# P9 — Node-graph redesign of Agents / Sessions / Inbox / Engine Terminal

Piece: P9 (worker). Branch `piece-nodegraph` on this worktree. Commit:
`e1fd4ab31e8ee2ab76347524e3e5c62cd8d689b6`.

## What was built

A shared graph module (`src/features/graph/`) and four redesigned views in the
**Prime Precision** style (dark instrument, copper #C98A5B, Space Grotesk /
Inter / JetBrains Mono, hairline rules, monochrome logo preserved).

- **Agents** → `src/features/agents/AgentsGraph.tsx` + `AgentsView.tsx`
  Fleet node graph: OPERATOR → DAEMON → daemon agents → RLM children.
  Status-colored instrument cards (running=ok, idle=muted, error=err), animated
  heartbeat dots + flowing dashes on live edges, Attach/Detach + Message actions
  on each node, clicking a node opens the unchanged coordination inspector
  (thread + composer).
- **Sessions** → `src/features/sessions/SessionsGraph.tsx` + `SessionsView.tsx`
  Graph of sessions + their goals + RLM children. Each session node carries a
  context-usage ring; Resume/Fork live on the node; clicking a session opens the
  unchanged SessionDetail inspector.
- **Inbox** → `src/features/inbox/InboxGraph.tsx` + `InboxView.tsx`
  Sender → message → receiver flow graph (YOU left, peer right, messages
  between), direction shown per message, unread copper-highlighted with a live
  edge pulse. Agent chips switch the peer; composer preserved.
- **Engine Terminal** → `src/features/engine/EngineGraph.tsx` + `EnginePanel.tsx`
  Live process graph (bridge → daemon → workers) with status nodes above the
  existing log stream (unchanged). Browser preview shows the graph in a clear
  preview state with no fake logs.

Shared: `src/features/graph/` — `GraphFlow` (styled React Flow v12 with dot
grid, controls, minimap), `NodeFrame`, `PulseEdge`, `dagreLayout`, status theme.
Stack: `@xyflow/react@12.11.2`, `framer-motion@13`, `dagre@0.8.5`,
`@types/dagre`. React 18. Graph/motion libs code-split for caching.

## Key fix (notable)

React Flow v12 drops rendered edges in controlled mode when node/edge arrays
are recreated on async data churn. Isolated the trigger to a recreated callback
(`unreadByAgent`) in the layout memo deps. Fixed by keeping the structural
layout memo keyed only on stable inputs and patching live unread counts **in
place** via `useNodesState` — edges stay rendered.

## Preserved

- All IPC wiring + functionality (attach, message, resume, fork, mark-read, etc.)
- Graceful empty / error / daemon-unreachable degradation on every view
- Prime Precision design tokens / type / motion; monochrome logo
- Chat + Settings views untouched

## Verification (all green)

- `npm run build` clean (tsc + vite)
- `npm install @xyflow/react framer-motion dagre @types/dagre` succeeds
- Browser smoke on a dev server: each of the 4 views renders its node graph,
  animations work, **zero console errors** across all views
- Scoped DOM checks (`verify/p9-detail.mjs`): Agents 4 nodes / 3 edges / 2
  animated + 2 heartbeat dots / inspector; Sessions 6 nodes / 3 edges / ring /
  detail; Inbox graceful empty state; Engine 3 nodes / 2 edges
- Screenshots: `verify/p9-agents.png`, `p9-sessions.png`, `p9-inbox.png`,
  `p9-engine.png`, `p9-chat-ok.png`

## How to run

```
npm install
npm run dev          # default port 1420 (P9 verified on 1421 because a
                     # sibling piece's leftover server held 1420)
```

Note: the browser-preview MockIpcClient intentionally surfaces empty
agents/inbox ("never faked data"), so in `npm run dev` the Inbox shows its
graceful empty state; the flow graph was verified to render with data via a
seeded check and renders with real relay data. Agent/Session/Engine graphs show
real mock data in preview.

## Round 2 — critic-driven fixes (both blocking defects closed)

- **D1 — nodes are draggable.** `GraphFlow` no longer hardcodes
  `nodesDraggable={false}`; it defaults to `true` (each view inherits it). The
  layout-spring CSS transition is scoped to `:not(.dragging)` so drags move
  instantly while auto-layout repositions still animate. Verified: mouse-drag
  moves a node's transform (190,204 → 304.8,250.1).
- **D2 — reduced-motion respected.** `PulseEdge` gates the SMIL heartbeat dot
  behind framer-motion's `useReducedMotion()`, and the flowing-dash rule now
  targets the real class (`.react-flow__edge-path.pg-animated`) in the
  `prefers-reduced-motion: reduce` block, with a `.react-flow__edges circle`
  safety net. The graph content is wrapped in `<MotionConfig reducedMotion="user">`
  so node enter animations also defer. Verified: normal dots=2/anim=pa-dash;
  reduce dots=0/anim=none.

Re-verified green: `npm run build` clean, `verify/p9-detail.mjs` +
`verify/p9-smoke.mjs` all PASS, zero console errors (favicon 404 is pre-existing).
