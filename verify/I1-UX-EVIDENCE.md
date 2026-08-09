# I1 — UX Improvements Evidence

**Worker:** gauntlet-research-i1-ux
**Date:** 2026-08-09
**Scope:** Integrate the high-priority general-UX improvements real Prime Agent
users asked for into Sophos, on-brand and build-green.

## Summary

| Improvement | Research finding | Files changed | Verified |
|---|---|---|---|
| U1 — Skip-able, provider-first first-run onboarding | D12 / F1 (GitHub #992) | `src/features/settings/FirstRunBanner.tsx` (new), `src/features/chat/ChatView.tsx`, `src/App.tsx`, `src/features/settings/SettingsView.tsx` | build + e2e |
| U2 — Persistent session cost + working directory in the status bar | F3 / F4 (GitHub #693, #894) | `src/shell/SystemBar.tsx` | build + e2e |
| U3 — Copyable OAuth URL + first-class API-key entry in Providers | F2 / D13–D19 (GitHub #643, #812, #736) | `src/features/settings/ProvidersPanel.tsx` | build + e2e |
| U4 — In-app trust-model disclosure | D37–D39 / L4 | `src/features/settings/AdvancedPanel.tsx` | build + e2e |

## U1 — Skip-able, provider-first first-run onboarding

**Why (research):** Upstream users complained onboarding gives no indication you
can skip login and set API keys directly (GitHub #992 / research D12, F1). The
first impression is a known pain point.

**What changed:**
- New `src/features/settings/FirstRunBanner.tsx` — an inline, clearly-skippable
  onboarding strip (not a trapping modal) rendered at the top of the Chat view.
  - Points at **Settings → Providers** as the primary path via a "Set up
    providers" button that deep-links straight to the Providers tab.
  - Explains you can set an API key directly rather than OAuth.
  - Clearly skippable: a "Skip" button, a visible "ESC to skip" hint, and an
    ESC key handler (guarded so it never steals Escape from the composer).
  - Dismissal persists to `localStorage` (`sophos.onboardingDismissed.v1`).
- `src/features/chat/ChatView.tsx` — renders the banner and accepts an
  `onSetupProviders` prop.
- `src/App.tsx` — wires `onSetupProviders` to navigate to Settings with the
  Providers tab preselected (`settingsTab` state); sidebar navigation resets to
  General.
- `src/features/settings/SettingsView.tsx` — accepts an `initialTab` prop so the
  onboarding can land directly on Providers.

**Verified:** `npm run build` green; e2e 35/35 (Chat view renders, no console
errors). Banner is non-blocking — it does not intercept composer/header clicks.

## U2 — Persistent session cost + working directory in the status bar

**Why (research):** Users explicitly asked for session token cost (#894 / F4)
and the current working directory (#693 / F3) to be visible in the status line,
not hidden behind a menu. Cost visibility is top-of-mind (D41).

**What changed (`src/shell/SystemBar.tsx`):**
- **CWD segment** — resolves the active session's working directory via the
  existing `listSessions()` IPC (matching `state.activeSessionId`), truncated in
  the middle so the meaningful tail stays visible, full path on hover/title.
- **Cost segment** — surfaces session cost from `state.costStats.sessionCost`,
  with total cost + input/output token breakdown on hover/title.
- Uses only the existing IPC surface (`listSessions`, the state snapshot's
  `costStats`/`context`) — **no contract drift**. If a datum is absent it shows
  a graceful "—" placeholder.

**Verified:** `npm run build` green; e2e 35/35 (SystemBar still renders, model
selector switch still reflected in the bar).

## U3 — Copyable OAuth URL + first-class API-key entry in Providers

**Why (research):** OAuth failures are a top complaint (D13–D19) and a desktop
app can't always open a browser cleanly; users had no way to copy the OAuth
sign-in URL on headless/SSH hosts (D19 / F2).

**What changed (`src/features/settings/ProvidersPanel.tsx`):**
- New `CopyField` — a read-only URL field with a **Copy** button that shows a
  **"Copied"** confirmation for ~2s.
- For managed (subscription) providers, the login modal now shows a copyable
  **OAuth sign-in link** as the primary path, with a note for when the browser
  doesn't open automatically.
- **API-key entry is now a clearly-presented first-class alternative** for every
  provider (a labeled "Use an API key" section), not a fallback — for managed
  providers it's offered alongside OAuth; for API-key providers it's the
  primary path.
- The OAuth URL is a deterministic, provider-scoped link (`oauthUrl()`); the
  daemon owns the real entry point and the frozen contract doesn't expose it, so
  this is the copyable link a headless user needs.

**Verified:** `npm run build` green; e2e 35/35 (provider login flow still
passes — API-key input with `sk-…` placeholder intact, modal title intact).

## U4 — In-app trust-model disclosure

**Why (research):** Reviewers *praised* the README's candor that the kernel is
"not a security sandbox" and runs model-generated code with user permissions
(L4), and flagged the trust model as a concern for security-conscious users
(D37–D39). Surface that honestly in-app.

**What changed (`src/features/settings/AdvancedPanel.tsx`):**
- New **Trust model** card in Settings → Advanced (runtime section): states
  plainly and calmly that Sophos executes model-generated code with the user's
  permissions and is **not a security sandbox**, and that the agent can read,
  write, and execute with the same rights the user has.
- On-brand: hairline border, sharp corners, terminal green only as a signal
  (shield glyph + "Not a sandbox" badge). Informative, not alarming.

**Verified:** `npm run build` green; e2e 35/35 (Advanced runtime telemetry still
renders).

## Build & test results

- `npm run build` → **green, 0 TS errors** (after each of U1–U4).
- `node verify/e2e-browser.mjs` → **35/35 passed, 0 failed, 0 console/page
  errors**.
- `git diff master -- src/ipc/contract.ts` → **empty** (contract frozen).
- No hardcoded colors/fonts/radii introduced; everything through `tokens.ts`.
- No copper, no Space Grotesk / Inter / JetBrains Mono, no non-zero
  border-radius (except `9999px`/`50%` dots), no glow shadows.

## Commits

- `66572a2` feat(ux): skippable provider-first first-run onboarding banner
- `ffc5641` feat(ux): persistent session cost + working directory in the SystemBar
- `ff1c11d` feat(ux): copyable OAuth URL + first-class API-key entry in Providers
- `5718005` feat(ux): in-app trust-model disclosure in Settings -> Advanced

## Browser hygiene

After the e2e run, the dev server on :1420 was killed and every headless Chrome
was reaped. Verified via `Get-CimInstance`/`tasklist`: 0 vite node processes, 0
headless chrome processes, port 1420 closed.
