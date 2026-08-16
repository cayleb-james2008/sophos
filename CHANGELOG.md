# Changelog

All notable changes to Sophos are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.6.0] — 2026-08-16 (Beta)

### Added
- **Demo mode** — launching the app with `--demo` (or `SOPHOS_DEMO_MODE=1`) makes the Rust shell skip the daemon/sidecar and inject `window.__SOPHOS_DEMO__ = true`, so the frontend uses the MockIpcClient. The full UI (Sessions, Agents, Chat, Inbox, Settings, Engine Terminal) is demonstrable and testable via cua-driver without a live provider.
- **cua-driver e2e test harness** — a reusable end-to-end test harness (`verify/cua/`) that drives the real Sophos desktop app through the cua-driver CLI: launches the app, reads UIA accessibility trees, clicks elements, types text, takes screenshots, and runs assertions. Six test suites cover every view: Sessions (8 tests), Agents (6 tests), Chat (12 tests), Inbox (5 tests), Settings (10 tests), Shell/Global (5 tests).
- **Simulated streaming chat turn in demo mode** — MockIpcClient now simulates a full streaming assistant turn (thinking → demo_echo tool call → chunked answer → queue-idle snapshot that clears busy), making the core Chat features demonstrable in demo mode.
- **Engine Terminal demo mode** — the Engine Terminal detects demo mode and renders a simulated live engine (status dots lit, process graph live, clearly-labeled demo log stream) instead of a dead empty terminal.

### Fixed
- **Session creation didn't update the session list** — `newSession`, `forkSession`, and `cloneSession` created a new session ID and set it active but never added the new session to `listSessions()`, so new sessions didn't appear in the Sessions graph. Now appends to a mutable session list.
- **Agent relay textarea wasn't typeable by computer-use** — the cua-driver harness types via UIA ValuePattern, which sets the DOM value without firing React's synthetic onChange. Added a native `input` listener + 200ms polling fallback to sync the DOM value into the React draft state.
- **Agents detail inspector overflow** — the agent detail console/body `max-height: 58%` was too tall, pushing the message composer below the visible area. Constrained to 38% and added `flex: 1` + `overflow: hidden` to the main container.
- **Inbox mark-as-read didn't work** — the Inbox graph passed node IDs with a `msg-` prefix (e.g., `msg-in-api-1`) to `markMsgRead`, but the lookup used the raw message ID (e.g., `in-api-1`), so the lookup always missed. Now strips the `msg-` prefix before the lookup.
- **Inbox showed no relay peers in demo mode** — when `listAgents()` returned empty (demo mode), the Inbox had no peers to route messages between. Now falls back to the RLM children (the same agents the Agents fleet surfaces).
- **First-run wizard appeared in demo mode** — the onboarding wizard launched even in `--demo` mode, blocking the UI behind a setup flow with no purpose without a live provider. Now skips onboarding in demo mode (treated as fully ready).
- **abort() was a no-op in demo mode** — `abort()` did nothing, so there was no way to stop a simulated turn. Now clears the in-flight chat turn timers.
- **steer() was a no-op in demo mode** — `steer()` did nothing, so the steering indicator never round-tripped. Now emits an acknowledgement event.
- **Side questions never completed in demo mode** — `startSideQuestion` started with a "running" status but never completed, leaving the inline panel stuck. Now emits a "complete" event with a demo answer after 1.3s.
- **Onboarding "Run again" silently did nothing** — `clearOnboardingDismissed()` only cleared the dismiss flag, not the "first message exists" flag, so re-launching the wizard from Settings silently did nothing after a first chat. Now clears both flags.
- **Updater manifest endpoint** — switched the auto-updater endpoint from the previous URL to the GitLab raw file URL for reliable manifest delivery.

### Tests
- **cua-driver e2e** — 6 test suites (Sessions, Agents, Chat, Inbox, Settings, Shell/Global) covering every view in the app, run in demo mode against the real Tauri release build.
- **Unit tests** — 984 tests pass (up from 982), `tsc --noEmit` clean.

## [0.5.0] — 2026-08-15 (Beta)

### Added
- **`/cd` command** — change the active session's working directory mid-session via a native directory picker (typed `/cd` in the composer, opens OS folder dialog, calls `runCommand("cd")`)
- **Persistent subagent model policy** — new SubagentPolicyPanel in Settings → Subagents tab: set default provider, model, and thinking level for RLM subagents, persisted across sessions via `setSettings`
- **Per-child composition knobs** — AgentComposer now has a collapsible composition panel with thinking level select (defaults from subagent policy) and skill multi-select (from daemon catalog minus disabled skills)
- **Keyboard shortcuts overlay** — press `?` or `Cmd/Ctrl+/` to see all registered shortcuts in a styled modal with Kbd chips; closes on Escape/backdrop click
- **ShortcutsOverlay component** — new design-system modal listing all `Hotkey` entries from the `useHotkeys` registry, grouped by category

### Changed
- **Inline styles eliminated** — all 58 `style={{}}` blocks in feature/view/shell/design components replaced with CSS classes or CSS custom properties; only dynamic CSS custom property refs remain (e.g. `--pa-skeleton-w`, `--ctx`, `--pad`)
- **Design system refactor** — Card, Modal, Tooltip, ScrollArea, Tabs, ErrorBoundary, Text, Button, Input, Select, Kbd, Spinner, Badge, StatusDot, Skeleton all className-driven via new CSS files (`primitives.css`, `overlay.css`, `motion.css`, `shortcuts-overlay.css`)
- **ViewScaffold** — gained optional `loading`/`error`/`onRetry`/`errorLabel` props with ErrorBoundary wrapper
- **EmptyState** — polished, reusable empty state component with icon, title, description, and optional action button
- **Error states** — chat error state upgraded to card with Retry button (disabled when no assistant turn to retry)
- **Loading states** — chat loading text replaced with pulsing skeleton
- **Sessions/Inbox/Graph/Goals/LongRunning** — all inline styles replaced with CSS custom properties (`--node-w`, `--node-color`, `--bar-w`, `--fill-w`, `--depth`, `--ring-size`, `--chevron-rot`) and CSS classes (`.card-stack-lg`, `.goals-panel`)

### Removed
- **Share button** — removed from chat header and command palette (was non-functional "not available yet"); Export and Copy buttons retained

### Fixed
- **Settings interface** — added `subagentDefaultProvider`, `subagentDefaultModel`, `subagentDefaultThinking` fields (additive, non-breaking)

### Tests
- 106 tests pass (9 files), up from 86 baseline — added 20 new tests for /cd command (8), subagent policy (6), ShortcutsOverlay (6)

## [0.4.0] — 2026-08-16 (Beta)

### Added
- **Beta release** — pre-v1.0 beta per the beta-labeling policy

## [0.2.0] — 2026-08-14 (Beta)

### Added
- **Test suite** — vitest + @testing-library/react + jsdom; 6 test files, 86 tests covering design-system primitives and critical hooks (useChat, useAgents, useRefinementGate, useModels)
- **CI pipeline** — GitHub Actions workflow (`.github/workflows/ci.yml`) runs `tsc --noEmit`, `vitest run`, and best-effort `verify/e2e.mjs` on every push and PR (Windows runner)
- **CONTRIBUTING.md** — build-from-source, testing, code style, and PR process guide for open-source contributors
- **Interactive MCP config** — add, remove, test connection, and toggle MCP servers entirely from the UI (no manual JSON editing); new `McpServersPanel` with `testMcpServer` IPC method
- **Extensions panel** — first-class `ExtensionsPanel` listing each extension's tools and slash commands with enable/disable toggles
- **Slash-command autocomplete** — typing `/` in the Composer surfaces a fuzzy-matched dropdown of all available slash commands (daemon-discovered + extension-provided) with descriptions, arrow-key navigation, and Enter to insert; new `SlashAutocomplete` component and `getSlashCommands` IPC method
- **Guided onboarding wizard** — 4-step wizard (Welcome → Provider → Model → First Prompt) replacing the FirstRunBanner checklist; launches on first run, re-triggerable from Settings → General; Skip at every step + Esc-to-dismiss
- **Light/dark/system theme** — full theme switching via CSS custom properties (`--pa-*` vars); dark mode default, light mode uses the Prime Intellect site's light palette; `system` follows OS preference; persists across restarts; no flash of wrong theme on launch (new `useTheme` hook + `theme.ts`)
- **Skill creator preview + enable/disable** — `SkillsPanel` updated with skill preview and per-skill enable/disable toggles
- **ErrorBoundary** — catches render errors with a token-styled fallback UI
- **Skeleton** — pulse-animation loading placeholder in the design system
- **Keyboard shortcut registry** (`useHotkeys` hook) — global shortcut registration (Cmd+1-4 view switching, Cmd+N new session, Cmd+, settings)
- **App-level state context** — reduces prop-drilling across views
- **Component sub-splits** — `Composer` split into `ComposerInput`, `FollowUpQueue`, `SideQuestionPanel`, `ShellNoticeBar`; `AdvancedPanel` split into `McpServersPanel`, `ExtensionsPanel`, focused context/RLM panels; `useChat` split into composable hooks (`useSideQuestions`, `useTranscript`)
- **Tauri v2 auto-updater** — signed update feed for seamless updates
- **Visual regression harness** — snapshot + visual regression tests for all 5 views
- **Sessions drag-to-arrange** — graph nodes can be dragged and positioned; layout persists across reloads
- **Responsive detail inspector** — Sessions detail inspector collapses cleanly under 900px width

### Changed
- All 65 raw `<button>` elements in feature components replaced with design-system `<Button>`/`<IconButton>` primitives
- Inline `style={{}}` blocks in feature components reduced from 551 to 48 (token references or CSS classes instead)
- Demo code gated behind `import.meta.env.DEV` — no longer renders in the shipped app
- `Input`, `TextArea`, `Select` forward refs for test accessibility
- Tokens now reference CSS custom properties (`var(--pa-*)`) so the entire app switches theme automatically

### Fixed
- Sessions inspector toggle chevron direction corrected
- Signature verification test hardened with real cryptographic checks

### Removed
- Transient gauntlet state files (`evaluator-state.json`, `generator-state.json`) removed from tracking and gitignored

## [0.1.0] — 2026-08-12 (Beta)

### Added
- **Windows-native desktop app** — Tauri v2 (Rust) shell that spawns and supervises the Prime Agent daemon
- **React frontend** — terminal-minimal UI styled after the Prime Intellect design language:
  - Near-black surfaces (`#0e0e0e`), hairline borders (`#2a2a2a`), terminal-green accent (`#85ed75`)
  - Geist + Geist Mono typography, sharp corners (0px radius everywhere)
  - Design-system primitives: Button, Input, TextArea, Select, Kbd, Badge, StatusDot, IconButton, Card, Modal, Tabs, Tooltip, ScrollArea
  - Motion layer: Fade, SlideUp, Stagger, ViewTransition (respects prefers-reduced-motion)
- **Feature-sliced architecture**:
  - **Chat** — streaming message list, markdown rendering, unified diff view for file edits, thinking blocks, tool-call cards, context bar, follow-up queue, side questions
  - **Sessions** — graph view + tree view, session detail inspector, new-session modal, fork/resume/clone actions, context ring readout
  - **Agents** — fleet graph, agent detail pane, agent composer (send messages to rlm children), skeleton + error + empty states
  - **Inbox** — agent relay message-flow graph, agent switcher, message composer
  - **Settings** — general, providers, skills, kernel, advanced, long-running panels; first-run onboarding banner
  - **Long-running** — autonomous panel, heartbeats, schedules, refinement history with Apply/Discard gate
  - **Engine** — engine graph, engine panel
  - **Commands** — ⌘K command palette with fuzzy search
- **Node bridge sidecar** — JSON-RPC bridge between the Tauri shell and the coding-agent daemon
- **IPC contract** — typed bridge between React frontend, Rust Tauri main process, and Node bridge
- **Persistent IPython kernel** — in-app cell execution surface (KernelPanel)
- **Skill management** — create and install skills from the UI (SkillsPanel)
- **Refinement gate** — interactive diff view with Apply/Discard for self-editing loops
- **Subagent spawn** — rlm() child agent attach/detach with live status
- **Agent messaging** — send messages to peer agents from inbox and agent detail
- **Safety controls** — e2e harness verifies bundle layout, daemon round-trip, safety controls
- **Signed NSIS installer** — `Sophos_0.1.0_x64-setup.exe` (~93 MB, bundles portable Node runtime)
- **TCP-loopback fallback** — when named pipes fail, daemon falls back to TCP transport
- **Settings persistence** — user choices and model selection persist across restarts
- **Race-safe lifecycle** — bridge and sidecar recovery is race-safe

### Fixed
- Console window flashes from daemon child processes eliminated
- Kernel workaround for upstream #660 (Python execution on Windows)
- Accent discipline — terminal green is signal-only (not decorative)
- Radius discipline — 0px everywhere except circular status dots
- Trailing whitespace cleaned for release hygiene

### Credits
- Based on [PrimeIntellect-ai/prime-agent](https://github.com/PrimeIntellect-ai/prime-agent) — all credit for the agent runtime, daemon, and bridge belongs to the Prime Intellect team.
- Built by [Cayleb](https://gitlab.com/caylebalvarez-james).