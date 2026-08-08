# P7 — Prime Precision frontend redesign — Worker evidence

Piece: **P7 (Prime Precision — dark instrument restyle)** on the merged app.
Branch: `piece-redesign` (forked from `master` with P1–P6 merged).

## What changed

### Design system
- **`src/design/tokens.ts`** — rewrote to the "Prime Precision" token set:
  - Colors: `bg #0A0B0D`, `surface #12141A`, `surface2 #181B22`, `line #23262E`,
    `text #E8E9EC`, `muted #8A8F98`, accent **precision copper `#C98A5B`**,
    ok `#4CAF7D`, warn `#D9A441`, err `#D05A5A`.
  - Existing token names kept stable (so feature modules keep compiling) with
    the spec-named aliases added.
  - Type scale: added `font.display` = Space Grotesk; body Inter; mono
    JetBrains Mono. Tighter spacing and sharper machined radii.
- **`src/design/core.tsx`** — display variant uses the display face; copper
  hover on accent-soft button; sharper Button/Badge radius; live status dot
  pulses with a crisp `pa-beat` heartbeat.
- **`src/design/global.css`** — near-black body, hairline scrollbars, precision
  copper focus ring, added `pa-beat` keyframe, reduced-motion respected.
- **`src/design/overlay.tsx`** — (consumes tokens; copper applied via tokens).
- **`index.html`** — loads Space Grotesk / Inter / JetBrains Mono from Google
  Fonts.

### Shell — the flight-deck frame
- **`src/shell/SystemBar.tsx`** — rewritten as the **live engine-telemetry
  strip** (the signature element): monochrome PRIME brand anchor, then a
  hairline-ruled readout with ENGINE status (pulsing dot) · AGENTS live ·
  MODEL/provider · CTX usage with a copper context meter. Wired to
  `useConnectionState` + `listAgents`/agent events so it is genuinely live.
- **`src/shell/Sidebar.tsx`** — rewritten as a **command rail**: hairline
  separators, single copper active indicator bar, monochrome bolt mark at the
  bottom.
- **`src/shell/Shell.tsx`** — removed the violet glow; subtle copper-tinted
  hairline grid backdrop; cleaned up the duplicated backdrop/content render.

### Views + feature CSS (accent sweep)
- **Removed all violet/purple** across the app: feature CSS files
  (`agents.css`, `sessions.css`, `settings.css`, `inbox.css`,
  `palette.css`), `highlight.tsx`, `MessageRow.tsx`, `SessionDetail.tsx`,
  `EnginePanel.tsx` colors. Every old palette value → precision-instrument
  value; every violet → copper.
- **Removed numbered `01/02/03` markers** (anti-slop) from Chat, Agents,
  Settings, and the view scaffolds.
- `ViewScaffold` uses the display face for headings.
- `EmptyState` quieted (no glow).

### Preserved
- All functionality + IPC wiring (visual restyle only). Engine terminal,
  daemon banner, command palette, sessions/agents/inbox/settings all intact.
- Monochrome logo (black/white, no purple).

## Round 2 — critic-driven fixes (both blocking defects resolved)

**[D1] Remaining violet palette — FIXED.** Critic found a distinct second
violet family (#b78aef, #8360c5, #8a5be0, #241b31, etc.) in inbox/agents/
sessions/palette CSS that my first sweep missed. Swept all of it to
copper/ink via a Python color-mapping pass + regex rgba sweep:
- inbox.css, agents.css, sessions.css, palette.css: every violet hex and
  purple rgba → copper accent (#C98A5B / #D6A077) or ink (surface/line/text).
- MessageRow.tsx #5b3bb0 → #C98A5B.
- Verified with an automated detector across ALL src: 0 true-violet colors.
- Browser-verified: computed-style scan of every element on all 5 views +
  engine terminal → **0 violet computed colors**.

**[D2] Space Grotesk not loading — FIXED.** Root cause: my global.css
`@font-face` declared `src: local("Space Grotesk")`, which shadowed the
Google Fonts link's proper @font-face (woff2 URLs) for the same family and
errored when the font wasn't installed system-wide. Removed the conflicting
block; the web font now loads. Verified in-browser:
- document.fonts status for Space Grotesk: `error` → `check("600 16px")=true`
  (face genuinely available); `document.fonts.load` returns 1 face.
- PRIME brand mark + all view h1 headings compute to Space Grotesk.
- Applied display face (Space Grotesk) to Sessions/Agents/Settings header h1s
  so the display personality carries across the whole app (with restraint).

## Verify gates
- `npm run build` — **clean** (tsc + vite build, 87 modules, no errors).
- `cargo check` — not needed (no Rust touched).
- Browser smoke via `npm run dev` (port 1420):
  - Chat, Sessions, Agents, Inbox, Settings all render.
  - Live telemetry strip renders (ENGINE LIVE · AGENTS 0 live · MODEL
    deepseek-v4-flash:0731-cloud · CTX 18.4k/200k 9%).
  - Engine terminal opens (browser-preview state, correct).
  - Body background resolves to `rgb(10, 11, 13)` (#0A0B0D); 8 inline copper
    accent hits confirmed.
  - **Zero page errors** across all views.
- Distinctiveness: near-black + **precision copper** (not acid/violet), no
  purple in logo/brand, display face used with restraint, signature = the
  telemetry strip + copper accent used sparingly.

## Screenshots (this worktree, `verify/`)
- `verify/p7-chat.png` / `p7-chat-final.png` — chat view + telemetry strip
- `verify/p7-sessions.png` — sessions command center
- `verify/p7-agents.png` — agent command center
- `verify/p7-inbox.png` — inbox
- `verify/p7-settings.png` — settings + fleet strip
- `verify/p7-engine-final.png` — engine terminal open
- Round-2 (after fixes): `verify/p7-r2-{Chat,Sessions,Agents,Inbox,Settings,Engine}.png`

## Worker state
- `worker-state.json` updated → P7 DESIGN MERGED (this worktree).
