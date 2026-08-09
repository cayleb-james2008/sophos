# P3 — Visual Alignment Audit + Fix: Drift Report

**Worker:** P3 (Visual Alignment Audit + Fix)
**Branch:** `gauntlet-p3-visual`
**Date:** 2026-08-08

## Scope audited
`src/design/*`, `src/features/*`, `src/views/*`, `src/shell/*`, `src/App.tsx`,
`index.html`, `src/main.tsx`. (bridge/ and src/ipc/ untouched — P1 scope; verify/ is P2 scope.)

## Audit method
1. Source grep sweep for every drift pattern in the design DNA (old fonts,
   copper, non-zero radius, gray shades, glow, hardcoded non-token colors).
2. `npm run build` (tsc + vite) — green.
3. Live computed-style sweep via Playwright/Chromium on all 5 views
   (chat, sessions, agents, inbox, settings) + command palette.
4. Screenshots of every view for the vision-capable critic.

## Drift found and fixed

### 1. Red error shades not using the danger token (#ef4444)
The design DNA defines `danger: #ef4444`. Several error states used ad-hoc
lighter/darker reds instead of the token or token-derived rgba.

| Before | After | Files |
|---|---|---|
| `#e98989` (error text) | `#ef4444` | agents.css, inbox.css |
| `#f87171` (danger hover text) | `#ef4444` | graph.css, sessions.css |
| `#8a3a3a` (error border) | `rgba(239,68,68,0.4)` | agents.css, inbox.css |
| `#2a1515` (error bg) | `rgba(239,68,68,0.12)` | agents.css, inbox.css |
| `#5a3030` (error hover border) | `rgba(239,68,68,0.45)` | agents.css |
| `rgba(208,90,90,0.10)` (error banner bg) | `rgba(239,68,68,0.12)` | useActionError.tsx |
| `rgba(208,90,90,0.08)` / `0.22` (error banner) | `rgba(239,68,68,0.12)` / `0.4` | sessions.css |

### 2. Gray shades instead of opacity-based text hierarchy
The design DNA requires text hierarchy via opacity on `#f4f4f4`, not gray
shades. Found a zinc-gray used for a thinking-block divider.

| Before | After | File |
|---|---|---|
| `rgba(161,161,170,0.06)` | `rgba(244,244,244,0.06)` | sessions.css |
| `rgba(161,161,170,0.3)` | `rgba(244,244,244,0.3)` | sessions.css |

### 3. Tailwind badge soft-backgrounds not derived from tokens
`Badge` tones in core.tsx used Tailwind green/amber/sky soft backgrounds that
don't match the token semantic colors.

| Before | After | File |
|---|---|---|
| success `rgba(34,197,94,0.12)` | `rgba(133,237,117,0.12)` | core.tsx |
| warning `rgba(245,158,11,0.12)` | `rgba(243,188,86,0.12)` | core.tsx |
| info `rgba(14,165,233,0.12)` | `rgba(139,124,246,0.12)` | core.tsx |
| `rgba(34,197,94,0.12)` (daemon status) | `rgba(133,237,117,0.12)` | AdvancedPanel.tsx |

### 4. Blur glows (design DNA: "no glow")
The design DNA is explicit: "No copper, no glow, no 'flight-deck' — stark,
minimal, terminal-grade." Shadows should be `none` or the 1px green ring
(`shadow.glow`). Removed all `0 0 Npx` blur glows (status dots, live
indicators, context meter, palette glyph, node selection, drop-shadows).

| Before | After | Files |
|---|---|---|
| `box-shadow: 0 0 12px #85ed75` | `none` | agents.css, inbox.css, sessions.css |
| `box-shadow: 0 0 10px rgba(133,237,117,0.5)` | `none` | agents.css, sessions.css |
| `box-shadow: 0 0 7px rgba(...)` (status dots) | `none` | agents.css, inbox.css, sessions.css |
| `box-shadow: 0 0 3px #85ed75` (keyframe) | `none` | inbox.css |
| `box-shadow: 0 0 12px #ef4444` | `none` | sessions.css |
| `box-shadow: 0 0 8px rgba(...)` (context meter) | `none` | sessions.css |
| `box-shadow: 0 0 8px rgba(...)` | `none` | sessions.css |
| `filter: drop-shadow(0 0 5px ...)` | `none` | sessions.css |
| `box-shadow: 0 12px 40px rgba(0,0,0,0.5), 0 0 0 1px ...` | `0 0 0 1px rgba(133,237,117,0.12)` (ring only) | palette.css |
| `text-shadow: 0 0 12px/18px rgba(133,237,117,...)` | removed | palette.css |
| `box-shadow: 0 0 0 1px ..., 0 10px 30px rgba(0,0,0,0.5)` | `0 0 0 1px rgba(133,237,117,0.2)` (ring only) | graph.css |
| `boxShadow: \`0 0 0 3px ${color}22, 0 0 12px ${color}55\`` | `0 0 0 3px ${color}22` (ring only) | core.tsx StatusDot |
| `boxShadow: \`0 0 8px ${tokens.color.accent}66\`` (active underline) | removed | overlay.tsx |
| `boxShadow: \`0 0 16px ${tokens.color.accent}44\`` (send btn) | removed | Composer.tsx |
| `boxShadow: \`0 0 8px ${tokens.color.accent}66\`` (cursor) | removed | MessageRow.tsx |
| `boxShadow: \`0 0 8px ${tokens.color.success}66\`` (status dots) | removed | GoalsPanel.tsx, HeartbeatsPanel.tsx, SchedulesPanel.tsx, AdvancedPanel.tsx |
| `boxShadow: \`0 0 6px ${color}88\`` (goal dot) | removed | SessionDetail.tsx |
| `boxShadow: \`0 0 12px ${tokens.color.accent}66\`` (progress fill) | removed | AdvancedPanel.tsx |

Kept (allowed by design DNA): 1px green rings, `inset 2px 0` active
indicators, `backdrop-filter: blur()` (fixed nav uses backdrop-blur per DNA),
`box-shadow: none`.

## Verified clean (no drift)
- **Old fonts** (Space Grotesk / JetBrains Mono / Inter): none anywhere.
- **Copper** (#C98A5B / #D6A077 / rgba(201,138,91,...)): none anywhere.
- **Non-zero border-radius**: all `0px` except `50%`/`9999px` circular dots.
- **Accent**: terminal green `#85ed75` is the sole accent; no copper.
- **Tokens consumed**: all hardcoded colors now match token values or are
  token-derived rgba. `tokens.ts` names unchanged (PRESERVE met).
- **Fonts loaded**: Geist Sans (400/500/600/700) + Geist Mono (400/500) via
  @fontsource in main.tsx.

## Evidence
- **Before screenshots** (HEAD state, pre-fix): `verify/p3-visual-round1/before/{chat,sessions,agents,inbox,settings,command-palette}.png`
- **After screenshots** (fixed state): `verify/p3-visual-round1/after/{chat,sessions,agents,inbox,settings,command-palette}.png`
- Computed-style sweep: `verify/p3-shots/computed-sweep.json`
- Multi-view sweep (all 5 views): 0 radius violations, 0 banned colors, 0 blur glows.

## Self-verdict
Contract met. Build green. No copper/old-font/non-zero-radius drift. All
views match the Prime Intellect design DNA. No headless browser/daemon left
running (dev server + playwright cleaned up after the run).
