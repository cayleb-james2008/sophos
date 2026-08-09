# RL — Long-running surface redesign (editorial, not flight-deck)

Visual redesign of the Long-running settings surface to read as stark, editorial,
terminal-grade — matching `settings-general.png` (the best-composed screen, 0.90)
and the primeintellect.ai DNA. The blind vision critic called the old surface
**"bolted-on and control-dense"** with **"three tiers of navigation before any
content"** and **"cards inside cards."** This closes that.

## Nav-structure rationale (B1)

**Choice: promote Long-running to its own top-level Settings entry** (option 3 in
the brief), rather than flattening all nine concerns into one tab row (option 1)
or merely deleting the redundant label (option 2).

- Old depth: Settings sidebar → `Advanced` → inner pill `Runtime telemetry |
  Long-running` → underline `Goals | Autonomous | Heartbeats | Schedules |
  Refinement` → a redundant `Long-running & background agents` label. **Three
  tiers plus a redundant label.**
- New depth: Settings sidebar (`General | Providers | Skills | Advanced |
  Long-running`) → underline `Goals | Autonomous | Heartbeats | Schedules |
  Refinement`. **Exactly two tiers.** The redundant label is gone — the tab says it.
- Rationale: "Advanced" is genuinely a *runtime telemetry / diagnostics* home;
  "Long-running" is a distinct concern (goals, autonomous, heartbeats,
  schedules, refinement). Nesting two different concerns under one entry was the
  bolted-on feel. A single nine-tab row (option 1) would cram
  General/Providers/Skills/Advanced/Goals/Autonomous/Heartbeats/Schedules/
  Refinement together, mixing concerns and overwhelming the user — worse. Making
  Long-running its own sidebar entry is the cleanest collapse and matches the
  critic's explicit suggestion.
- All five sections remain reachable; the Settings sidebar still works; the
  e2e and visual-sweep harnesses drive the new structure (see Verification).

**Files (B1):** `src/features/settings/SettingsView.tsx` (added the
`longrunning` tab + panel), `src/features/settings/LongRunningPanel.tsx` (new —
hosts the five underline tabs), `src/features/settings/AdvancedPanel.tsx`
(removed the inner pill and long-running branch; Advanced is now runtime-only
with a "Runtime telemetry" section label, matching GeneralPanel's rhythm),
`verify/e2e/views.test.mjs` (long-running test now drives `Long-running` as a
top-level tab, still asserts every panel renders).

## Flattened containers (B2)

The DNA divides with hairline `#2a2a2a` rules and whitespace, not stacked
bordered boxes. Each panel went from *one raised Card wrapping boxed status
strips, boxed budget rows, and bordered list rows* to **one flat card with
hairline-ruled subsections and plain rows** — the GeneralPanel manner.

- `AutonomousPanel.tsx`: nested boxes removed. The boxed "Active budget" strip
  is now a hairline-ruled caption in the Budget section; each quality gate is a
  plain `CheckIcon + mono command + dim description` line, not a bordered box.
  Dashed "Not running" state kept.
- `GoalsPanel.tsx`: reshaped from a narrow (280–360px) side-rail card to a
  full-width family card (it is only mounted in the Long-running section). Goal
  rows are now plain `dot + objective + badge + actions` lines, not bordered
  boxes. Dashed empty state kept.
- `HeartbeatsPanel.tsx` / `SchedulesPanel.tsx`: list rows flattened to plain
  hairline-ruled lines; dashed empty states kept.
- `RefinementHistory.tsx`: auto-apply row and history rows flattened to plain
  ruled rows; the pending-proposal green box (the human gate) and the amber
  trust note are kept distinct because they are safety-critical alerts.
- All five: the boxed 34px icon squares in the headers were dropped for a clean
  text title + state badge, matching GeneralPanel.

## Lead with one clear state + one clear action (B3)

Each panel opens with a single strong line answering *"is this on, and what do I
do next?"* before the controls. Green is used only as the live/active signal
(via `Text tone="success"`/`"accent"`), never decoration.

- **Autonomous:** `Autonomous mode is off — start it…` / `…is running — stop it…`;
  Start/Stop is the first action, then budget inputs, then gates.
- **Goals:** `No active goals — set one to start.` / `N active goals in progress…`;
  the Set-goal form leads.
- **Heartbeats / Schedules:** `No heartbeat set — set an interval above.` /
  `N active heartbeat(s) set…`; the Set/Add form leads.
- **Refinement:** `No pending changes — run a refine pass when ready.` /
  `One proposed change awaits your review — apply or discard it below.`

## Safety controls preserved (explicit)

Restyle only. Behaviour untouched:
- **Refinement review-and-approve gate** (`useRefinementGate.ts`): auto-apply
  stays **OFF by default**, pending proposal is held, **Apply / Discard stay
  explicit**. The pending green box is unchanged in function.
- **Run guard / dead-engine detector + spend-and-iteration circuit-breaker**
  (`useRunGuard.ts`, `RunGuardBanner.tsx`): untouched — banners still surface
  engine-down and budget-tripped with one-click recovery.
- **Stall detection** (`useStall.ts`): untouched; stalled alerts kept.
- `git diff master` on all three hooks is empty. No IPC contract change.

## Verification

- `npm run build` — **green, 0 TS errors** (after each of B1, B2, B3).
- `node verify/e2e-browser.mjs` — **35/35 PASS**, including the long-running
  test that genuinely clicks Goals/Autonomous/Heartbeats/Schedules/Refinement
  and asserts each panel's content (not a smoke test). The edge
  "No console/page errors across all views" test passes.
- `python verify/v1-visual-match.py` — **9/9 views, 0 blockers**, including
  `settings:Long-running` (0 radius violations, no copper, no banned fonts, no
  glow).
- `git diff master -- src/ipc/contract.ts` — **empty** (contract frozen).
- `git diff master -- vite.config.ts` — **empty** (dev-server config untouched).

### Environment note (escalated, not worked around)
This worktree has **no local `node_modules`**; the shared
`cayleb-james2008__sophos/node_modules` is a junction to the old
`prime-agent-windows` repo (`Desktop\workspace\prime-agent-windows\node_modules`),
which is **outside Vite's workspace fs.allow**. The Geist fonts (`@fontsource/…`)
are therefore served through `/@fs/` from that foreign path and **return 403**,
so in dev the fonts fall back to system-ui. This produces 4 benign
"Failed to load resource: 403" console entries in the e2e report (not caught by
the suite's own console-error gate, which passed) and means dev-mode screenshots
render in a fallback font rather than Geist. Fixing it requires either a real
local `node_modules` (`npm install` — forbidden by the brief) or
`server.fs.allow` in `vite.config.ts` (forbidden by the brief), so per the brief
this environment oddity is **reported rather than worked around**. Separately,
headless Chrome on this Strix-Halo machine occasionally crashes the renderer
under sustained suite load at a variable test point (not the redesigned panels —
they pass after a relaunch); the e2e was retried to a clean 35/35.

## Commits

| SHA | Item |
|---|---|
| `ae9a3e7` | B1 — flatten nav to two tiers (SettingsView + LongRunningPanel + AdvancedPanel + e2e test) |
| `02d0489` | B2 — flatten nested containers into ruled family layout (five panels) |
| `60c3970` | B3 — lead each section with one clear state + action |

## Evidence

- Before/after screenshots of the five sections: `verify/rl-longrunning/after-{goals,autonomous,heartbeats,schedules,refinement}.png`
  (the "before" state is the critic's verdict: three-tier nav + nested
  cards-inside-cards, captured by the design DNA doc; the rebuilt panels are the
  after shots).
- e2e report: `verify/e2e/e2e-report.json` (35/35), summary
  `verify/e2e/e2e-summary.md`, screenshots in `verify/e2e/screenshots/`
  (incl. `…settings-longrunning.png`).
- Visual sweep: `verify/v1-visual/report.json` (9/9, 0 blockers) + shots.
