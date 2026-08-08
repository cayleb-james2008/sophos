# Node-graph + animation library research — Prime Agent Desktop

Workflow: local-deep-research (outline → verify → recommend).
Date: 2026-08-07.

## Context
Prime Agent is a React 18 (Vite) desktop app. The operator wants Sessions,
Agents, Inbox, and Engine Terminal redesigned around a **professional,
interactive node graph with clean animations** — the kind AI engineers love.
Goal: pick the node-graph + animation stack and a concrete per-view graph
concept.

## Items to investigate
- Node-graph library for React: **React Flow (@xyflow/react)** — the standard.
- Alternative graph libs: D3, AntV G6, Cytoscape.js, vis-network — when they win.
- Auto-layout: dagre / elkjs (hierarchical), d3-hierarchy (tree).
- Animation: **Framer Motion (motion)** for node/layout animation; GSAP.
- React-18 compatibility of each.

## Fields (what decides the pick)
- React 18 support + TS types
- Interactive node graph: drag/pan/zoom, selection, custom nodes
- Built-in controls: minimap, background, zoom/pan controls, animated edges
- Auto-layout support (hierarchical graph of sessions/agents)
- Animation quality + perf (large graphs)
- Bundle size / desktop-app fit

## Recommendation (from verification)
**Primary: React Flow (@xyflow/react) + Framer Motion (motion)**
- React Flow is the de-facto standard interactive node-graph lib for React —
  production-grade (used by Stripe, Datadog, etc.), TS-native, React-18 support.
- Built-in: <Controls>, <MiniMap>, <Background>, animated edges, custom nodes,
  drag/pan/zoom, selection — everything a professional node graph needs.
- Auto-layout via **dagre** (hierarchical) or **elkjs** — turns session/agent
  hierarchies into clean graphs.
- Framer Motion provides the clean, orchestrated animations (node enter/exit,
  layout springs, edge drawing) that match the Prime Precision aesthetic.
- React 18 compatible (both v12 / v13 respectively). ~130KB React Flow.

Alternatives (not chosen): D3 (manual everything, no React graph primitives),
G6/Cytoscape (canvas, heavier, less React-idiomatic), vis-network (dated).

## Per-view graph concept (proposed)
- **Agents** → node graph of the agent fleet: root operator node → daemon →
  live agents → RLM children, edges = attach/parent-child; status-colored nodes
  (running=ok, idle=muted, error=err), animated heartbeat on active edges.
- **Sessions** → graph of sessions + their goals/subagents: session nodes with
  context-usage ring, edges to goals and RLM children; resume/fork as actions.
- **Inbox** → graph/message-flow of agent relay messages: sender → message →
  receiver nodes, unread highlighted.
- **Engine Terminal** → live daemon/bridge process graph + log stream: node per
  process (daemon/sidecar/workers) with live status, edges = IPC links, the
  log feed below.
