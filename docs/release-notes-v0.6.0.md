# Sophos v0.6.0 (Beta)

**Released:** 2026-08-16

Sophos v0.6.0 ships the fixes from the cua-driver end-to-end testing pass. We added a demo mode and a reusable cua-driver e2e test harness that drives the real desktop app through the cua-driver CLI — launching the app, reading UIA accessibility trees, clicking elements, typing text, and running assertions — and used it to exercise every view. That pass surfaced and fixed twelve bugs across session management, the agent relay, the inbox, demo mode, onboarding, and the auto-updater, and added six e2e test suites covering the whole app.

---

## What is Sophos

Sophos is a Windows-native coding agent that brings [Prime Intellect's](https://www.primeintellect.ai/) open-source coding agent to the desktop as a polished app — a Tauri v2 (Rust) shell, a Node bridge sidecar, and a React frontend styled after the Prime Intellect design language (Geist typography, terminal-green accents, sharp corners, near-black surfaces). The daemon does the actual AI work; the bridge translates between the daemon's event stream and the frontend's IPC; and the frontend gives you a terminal-minimal chat, session graph, fleet, inbox, and settings — all running locally on Windows.

---

## What's new in v0.6.0

### Added

- **Demo mode** — launching the app with `--demo` (or `SOPHOS_DEMO_MODE=1`) makes the Rust shell skip the daemon and sidecar and inject `window.__SOPHOS_DEMO__ = true`, so the frontend uses the MockIpcClient. The full UI (Sessions, Agents, Chat, Inbox, Settings, Engine Terminal) is demonstrable and testable via cua-driver without a live provider.
- **cua-driver e2e test harness** — a reusable end-to-end test harness (`verify/cua/`) that drives the real Sophos desktop app through the cua-driver CLI: launches the app, reads UIA accessibility trees, clicks elements, types text, takes screenshots, and runs assertions. Six test suites cover every view: Sessions (8 tests), Agents (6 tests), Chat (12 tests), Inbox (5 tests), Settings (10 tests), Shell/Global (5 tests).
- **Simulated streaming chat turn in demo mode** — MockIpcClient now simulates a full streaming assistant turn (thinking → `demo_echo` tool call → chunked answer → queue-idle snapshot that clears busy), making the core Chat features demonstrable in demo mode.
- **Engine Terminal demo mode** — the Engine Terminal detects demo mode and renders a simulated live engine (status dots lit, process graph live, clearly-labeled demo log stream) instead of a dead empty terminal.

### Fixed

- **Session creation didn't update the session list** — `newSession`, `forkSession`, and `cloneSession` created a new session ID and set it active but never added the new session to `listSessions()`, so new sessions didn't appear in the Sessions graph. Now appends to a mutable session list.
- **Agent relay textarea wasn't typeable by computer-use** — the cua-driver harness types via UIA ValuePattern, which sets the DOM value without firing React's synthetic onChange. Added a native `input` listener plus a 200ms polling fallback to sync the DOM value into the React draft state.
- **Agents detail inspector overflow** — the agent detail console/body `max-height: 58%` was too tall, pushing the message composer below the visible area. Constrained to 38% and added `flex: 1` + `overflow: hidden` to the main container.
- **Inbox mark-as-read didn't work** — the Inbox graph passed node IDs with a `msg-` prefix (e.g. `msg-in-api-1`) to `markMsgRead`, but the lookup used the raw message ID (e.g. `in-api-1`), so the lookup always missed. Now strips the `msg-` prefix before the lookup.
- **Inbox showed no relay peers in demo mode** — when `listAgents()` returned empty (demo mode), the Inbox had no peers to route messages between. Now falls back to the RLM children (the same agents the Agents fleet surfaces).
- **First-run wizard appeared in demo mode** — the onboarding wizard launched even in `--demo` mode, blocking the UI behind a setup flow with no purpose without a live provider. Now skips onboarding in demo mode (treated as fully ready).
- **abort() was a no-op in demo mode** — `abort()` did nothing, so there was no way to stop a simulated turn. Now clears the in-flight chat turn timers.
- **steer() was a no-op in demo mode** — `steer()` did nothing, so the steering indicator never round-tripped. Now emits an acknowledgement event.
- **Side questions never completed in demo mode** — `startSideQuestion` started with a "running" status but never completed, leaving the inline panel stuck. Now emits a "complete" event with a demo answer after 1.3s.
- **Onboarding "Run again" silently did nothing** — `clearOnboardingDismissed()` only cleared the dismiss flag, not the "first message exists" flag, so re-launching the wizard from Settings silently did nothing after a first chat. Now clears both flags.
- **Updater manifest endpoint** — switched the auto-updater endpoint from the previous URL to the GitLab raw file URL for reliable manifest delivery.
- **Engine Terminal showed a dead empty state in demo mode** — without a live engine, the Engine Terminal rendered an empty, non-functional view. Now detects demo mode and renders a simulated live engine (status dots lit, process graph live, clearly-labeled demo log stream) instead.

### Tests

- **cua-driver e2e** — 6 test suites (Sessions, Agents, Chat, Inbox, Settings, Shell/Global) covering every view in the app, run in demo mode against the real Tauri release build.
- **Unit tests** — 984 tests pass (up from 982), `tsc --noEmit` clean.

---

## Download

| Item | Link |
|---|---|
| **Installer** | `Sophos_0.6.0_x64-setup.exe` (attached as release asset) |
| **Releases page** | [https://gitlab.com/caylebalvarez-james/sophos/-/releases](https://gitlab.com/caylebalvarez-james/sophos/-/releases) |
| **Full changelog** | [CHANGELOG.md](https://gitlab.com/caylebalvarez-james/sophos/-/blob/main/CHANGELOG.md) |

The installer bundles the portable Node runtime, daemon `dist/`, bridge `dist/`, and shared `node_modules/` — zero manual dependencies. No admin required; installs to `~\AppData\Local\Sophos`.

> **⚠️ Beta Notice:** All Sophos versions before v1.0 are beta releases. Features may change, and there may be bugs. Use in production at your own risk.

---

## Credits

Sophos is a Windows port of [PrimeIntellect-ai/prime-agent](https://github.com/PrimeIntellect-ai/prime-agent). All credit for the agent runtime, daemon, and bridge belongs to the Prime Intellect team.

Built by [Cayleb](https://gitlab.com/caylebalvarez-james).
