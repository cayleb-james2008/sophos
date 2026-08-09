# RA — Agents view redesign (0.55 → editorial terminal standard)

**Author:** Cayleb James
**Branch:** `redesign-agents-view`
**Goal:** Move the Agents view from the worst-scoring surface (0.55) toward the
standard of `settings-general.png` (0.90) by making it read stark, editorial,
terminal-grade — with the fleet graph as the single dominant object — and by
fixing the three concrete breakages the critic called out.

Reference: https://www.primeintellect.ai/ (research/sophos-design-dna.md).

---

## A1 — Stop mid-word wrapping in the detail rows (critic D3)

**Defect:** `deepseek-v4-flash: 0731-clo / ud` and `Reviewin / g endpoint /
contracts` — values shredded mid-word.

**Root cause (diagnosed):** `.ag-detail__rowvalue--mono` and
`.ag-detail__row span:last-child` both used `word-break: break-all`, and the row
was a horizontal `icon | label | value` flex inside the 384px rail with a
2-column grid, leaving the value almost no room.

**Fix:**
- `src/features/agents/agents.css` — restructured `.ag-detail__body` to a single
  column and `.ag-detail__row` to a **definition-list stack**: label above value,
  hairline-divided, no nested card-in-card boxes. Dropped `word-break: break-all`
  for `overflow-wrap: anywhere` (splits a long opaque id only when it alone
  overflows; never shreds words like `subagent` or `contracts`).
- `src/features/agents/AgentDetail.tsx` — the `Row` now renders a
  `.ag-detail__rowhead` (icon + label) above the full-width `.ag-detail__rowvalue`
  span, with a `title` tooltip so an opaque id stays fully readable on hover.

**Before:** cramped 3-column row, `break-all`, value ~90px wide.
**After:** single-column definition list, value gets the full rail width, wraps at
word boundaries.

---

## A2 — Stop the Send button wrapping (critic D4)

**Defect:** the composer put a long counter string + `Send message ↗` on one row
inside the narrow rail, so the button wrapped onto two lines.

**Fix (`src/features/agents/AgentComposer.tsx`, `agents.css`):**
- Shortened the button label to `Send`.
- Cut the redundant counter prose (`· encrypted agent channel · {n} remaining`)
  down to `{n} / 2000` (it said the same thing twice).
- Pinned the footer to a single nowrap row: button `flex:none` + `white-space:
  nowrap`, counter truncates with ellipsis. ⌘/Ctrl+Enter still sends (untouched).

---

## A3 — Fix minimap / zoom-control overlap (critic D5)

**Defect:** `<Controls position="bottom-right">` and `<MiniMap
position="bottom-right">` stacked on top of each other in the shared graph shell.

**Fix:**
- `src/features/graph/GraphCanvas.tsx` — moved the minimap to **top-right** (the
  zoom controls stay bottom-right), so they never collide. This applies to every
  graph view that shares `GraphFlow` (Sessions, Engine, Inbox).
- Added a `showMiniMap` prop (default `true`).
- `src/features/agents/AgentsGraph.tsx` — passes `showMiniMap={false}`.

**Why hide it on Agents (justified editorial choice):** the fleet graph is a
compact handful of nodes that `fitView` already shows in full at once — a minimap
is redundant chrome sitting on the primary object. Removing it gives the graph
undivided dominance (A4) and, together with moving the minimap top-right on the
shared views, closes D5 everywhere. Zoom/fit controls remain on Agents.

---

## A4 — The redesign: one dominant idea (the fleet graph)

**Defect:** the view stacked eyebrow+pulse → h1 → subtitle → a boxed 4-stat
telemetry rail → error banner → a full-width RUNTIME MODEL strip → graph →
inspector → a permanent footer hint. Six competing bands.

**Fix (`src/features/agents/AgentsView.tsx`, `agents.css`):**
- Collapsed the header stack into **one restrained band**: eyebrow caption +
  title + subtitle on the left; hairline-separated telemetry with the runtime
  model folded in beneath it on the right. The full-width RUNTIME MODEL strip and
  the boxed telemetry card are gone.
- Removed the permanent footer hint (`RELAY ACTIVE · click a node…`) — it was
  chrome, not information.
- The fleet graph is now clearly the primary object; everything else is quiet
  supporting context.
- **Green is signal-only** now: the eyebrow and the model provider fell back to
  off-white opacity; green remains only on live/running/unread/connection dots.
- Removed the inspector's ledger-line / nested-gradient surface (the "instrument"
  feel) for a clean `#151515` surface with hairline definition-list dividers.

**No feature removal:** attach/detach, the coordination thread, the composer,
unread counts, refresh, and all error/empty/loading states remain reachable —
this is a representation change.

---

## Evidence

- **Build:** `npm run build` green, 0 TS errors (after each of A1–A4).
- **e2e:** `node verify/e2e-browser.mjs` → **35/35, RESULT PASS**. The dedicated
  `No console/page errors across all views` test passes with 0 errors; both
  Agents tests pass unchanged (`text=Agent command center`, `text=RUNTIME MODEL`,
  `text=2 total`, both RLM-child summary assertions).
- **Visual sweep:** `python verify/v1-visual-match.py` → **9/9 views, 0 blockers,
  RESULT PASS** (agents accent=34, radius_viol=0).
- **Contract frozen:** `git diff master -- src/ipc/contract.ts` empty.
- **Dev-server config untouched:** `git diff master -- vite.config.ts` empty.
- **Compliance:** no copper, no Space Grotesk/JetBrains Mono, no non-zero radius
  except circular status dots, no glow shadows (0 radius_viol / 0 blockers in the
  sweep), no new hardcoded colours outside the token palette.

**Screenshots (before/after):** `verify/ra-agents/before-redesign.png` and
`verify/ra-agents/after-redesign.png` (captured at 1680×980, matching the sweep).
`verify/ra-agents/capture.mjs` is the capture harness used.

---

## Commit SHAs

| Item | SHA | Message |
|---|---|---|
| A1 | `e27d90e6ce034492e8ac7d11488eae72cb95ddd9` | fix(agents): stop mid-word wrapping in detail rows (D3) |
| A2 | `c96029a8c5cf5ea71bb1e4a2a4a7659a8ac19db8` | fix(agents): stop the Send button wrapping in the composer (D4) |
| A3 | `9b5ba55e20319c9d9d27f4aa59b7db7b7651560a` | fix(graph): stop minimap colliding with zoom controls (D5) |
| A4 | `92cf7eb92ee77e156c242e562e1a5acd3a25b2a9` | redesign(agents): collapse the flight-deck header into one restrained band |

---

## Known environment oddity (flagged, not worked around)

The dev server logs **4 pre-existing 403 font-load errors**:
`@fontsource/geist-mono` woff/woff2 requests via Vite's `@fs/` path into
`C:/Users/Cayleb/Desktop/workspace/prime-agent-windows/node_modules/...`. Vite's
`server.fs.allow` blocks serving these because `node_modules` here is a **symlink
into another project** (`cayleb-james2008__sophos/node_modules → prime-agent-windows/node_modules`),
outside the workspace root. This is an environment issue, not a regression from
this redesign — the fonts bundle correctly into `dist/` in the production build,
and the dedicated e2e error-sweep reports 0 real errors. I did not alter
`vite.config.ts` (frozen) or the node_modules layout to suppress it.
