# Changelog

All notable changes to Sophos are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.7.2] — 2026-08-16 (Beta)

### Added
- **Real auto-updater trigger** — the app now checks the update feed on every launch (fire-and-forget, never blocks or fails startup) and shows a one-click banner when a newer version is available: "Update available — Sophos X.Y.Z" with an **Install & restart** button. The Rust shell owns the whole flow — the startup check (feed endpoint overridable with `SOPHOS_UPDATE_ENDPOINT` for staging/e2e) emits `update-available` / `update-up-to-date` / `update-check-error` events, the `UpdateBanner` in the Shell listens and renders, and clicking Install calls `install_update`, which downloads the signed installer, verifies its Ed25519 signature against the configured pubkey, installs it, and relaunches the app. Previously the updater plugin was registered but nothing ever called `check()`, so the published feeds (0.4 → 0.6) were never consumed — this is the trigger that makes the update feed actually reach users.

### Tests
- Unit — 1118 pass (up from 1113), `tsc --noEmit` clean. New coverage: `UpdateBanner` (renders nothing until the event, shows the announced version + notes, Install invokes `install_update` and flips to the downloading state, install-error surfaces visibly, listeners unregister on unmount).
- cua-driver e2e — settings suite re-verified green (version badge now asserts 0.7.2); the update apply flow was verified live end to end (installed 0.7.2 pulled and installed the signed update from a staging feed, then relaunched).

## [0.7.1] — 2026-08-16 (Beta)

### Added
- **Profile Studio (Creator mode, made visual)** — build YOUR OWN agent profile from the live runtime, exactly the three things DeepSeek Harness Creator mode is built around: **inspect** the live runtime, **compose** capabilities, **test in memory**. The studio opens from the header profile chip (Profile → Profile Studio — build your own) and the picker gains a **Custom** section beside the five built-ins (Gauntlet / Standard / Minimal / Creator / Code).
  - **Custom-profile store** — persists in settings under the additive `customProfiles` key (same pattern as `agentProfile` / `mcpServers` / `disabledSkills`; the bridge SettingsStore merges unknown keys and the daemon ignores them). Parsing is guarded: garbage in → clean list out, malformed entries are sanitized, and an unusable profile (no name, no tools) **degrades to Standard defaults instead of crashing** — the header chip, composer hint, and demo responses always have something sane to render.
  - **Studio editor** — name, tagline, description, working style (one chip per line), base mode (Standard / Minimal / Creator / Code), **tool toggles from the LIVE Code Mode registry** (built-in / extension / MCP / skill groups with per-category counts — a source that is absent degrades honestly with a note), skill toggles (discovered skills + "All enabled skills"), and safety posture (auto-approve vs. a confirm list).
  - **Live runtime inspection** — the editor composes from the same deterministic registry the Code Mode SDK renders (`getRuntimeInfo` / `getExtensions` / `testMcpServer` — no new IPC), with a live composition summary that updates with every toggle and a "what the app shows right now" preview of the header chip, composer hint, and demo-response flavor.
  - **Hot reload + in-memory testing** — every edit dispatches to the shared profile state, so the running app follows the draft immediately without saving: the header chip, composer hint, and (in demo mode) the simulated responses all read the draft. **Save** persists to settings (and selects a newly created profile), **Discard** drops the draft, **Delete** removes the profile (falling back to Standard when it was active). No restart needed for any of it.
  - **Picker integration** — custom profiles appear in a "Custom" section with per-profile composition summaries plus Edit / Delete actions; the selection and the store survive restarts (persisted settings, guarded load).
- **Profile portability (export / import — the config-as-plugins half)** — any custom profile can be saved to a **human-readable JSON file** (a `sophos-custom-profile` envelope, pretty-printed) and loaded back or shared.
  - **Export** — from the studio footer (exports the live draft, even before Save — hot-reload philosophy) or from a custom profile's card in the picker. Writes through the **native save dialog** (Tauri dialog plugin) to a `*.sophos-profile.json` file via two tiny shell commands (`read_text_file` / `write_text_file` — frontend↔shell only; the daemon contract is untouched); the browser preview falls back to a Blob download. Cancelling the dialog is a silent no-op, never an error.
  - **Import** — from the picker's Custom section or the studio footer via the **native open dialog**; the browser preview uses a file input. Parsing is guarded end to end: malformed JSON, a foreign file, a future file version, a broken field shape, or an unusable profile (no name / no tools) each produce a clear, visible error — the app never crashes.
  - **Round-trip identity** — import re-parses through the SAME guarded store sanitizer that persists settings, so export → import reproduces the identical composition (mode, tools, skills, safety, name, tagline, working style). A name collision is **never silently overwritten**: the incoming profile is adopted as a unique copy (`"Name (copy)"`, `"Name (copy 2)"`, …) with a fresh id when ids collide, and the resolution is shown as a visible notice ("…already exists, so nothing was overwritten"). The imported profile is persisted and selected immediately, so its effect is visible without a restart.
- **Custom profiles ride on prompts as an additive demo hint** — the active profile's live display flavor (`profileFlavor`, name/tagline/working-style/mode) rides on prompt options so demo-mode simulation follows the studio draft even before Save; the Rust shell and bridge strip unknown option fields, so it never reaches the daemon.

### Known limitations
- **Custom profile instructions are a UI-layer hint, exactly like the built-ins** — the daemon contract has no seam to apply a profile's composed instructions (system prompt / tool set / safety posture) to live sessions: the bridge forwards only `streamingBehavior` and `queueIfBusy` from prompt options, and `setSettings` merges unknown keys without the daemon acting on them. Custom profiles therefore behave like today's built-in profiles: they visibly change the header chip, composer hint, composition summary, and demo responses, and persist in settings — but wiring them into the live daemon requires a bridge/daemon/contract change (a future release). This is a documented seam, not a blocker: the full studio ships on the additive-hint contract.
- **`cargo build --release` now requires the `custom-protocol` tauri feature** — a plain `cargo build --release` without it produced a release exe whose WebView2 could not reach the embedded frontend (connection refused on the app URL). Enabled `tauri = { features = ["custom-protocol"] }` (what `tauri build` enables by default); the cua-driver e2e suites run against the raw exe, so this keeps `cargo build --release` a working build path.

### Changed
- **Profile selector** — the trigger's mode chip now reads the effective composition mode, so while the studio is open it follows the draft; the picker renders a Custom section and a Profile Studio entry.

### Tests
- Unit tests — 1113 pass (up from 1077), `tsc --noEmit` clean. New coverage: the custom-profile store (guarded parse, sanitize/coerce, validate, degrade-to-Standard, id generation, system-prompt synthesis, composition), the studio editor reducer (every action, working-style parsing, live composition summary), demo-mode follow-the-draft (browser preview path with profile objects, MockIpcClient resolution from settings + live `profileFlavor`, custom code-mode routing, Gauntlet/string backward compatibility), and **profile portability** — serialize (envelope format, sanitized payload, file-name suggestion), guarded parse (malformed JSON / foreign envelope / bad version / broken field shapes / unusable profiles each error clearly, never throw), collision-safe merge (fresh id on id collisions, `(copy)` / `(copy 2)` renames on name collisions, case-insensitive, existing store never mutated), the export→import **round-trip** (identical composition), the visible collision notice phrasing, browser-preview file I/O (Blob download, file-input import, cancel detection), and a StudioPanel integration suite driving the REAL store + merge + persist through mocked native dialogs (export writes the serialized draft, import persists + selects, a collision resolves visibly without overwriting, malformed/unusable files show clear errors).
- cua-driver e2e — **8 suites green** against the rebuilt release exe: the new `verify/cua/studio.test.mjs` covers the studio opening from the header chip, create → auto-select → picker listing, demo responses following the custom profile's flavor, edit hot-reload + Save, Discard revert, Delete → Standard fallback, and selection + store surviving an app restart; the existing 7 suites (SMOKE, SESSIONS, AGENTS, CHAT, INBOX, SETTINGS, SHELL) stay green.

## [0.7.0] — 2026-08-16 (Beta)

### Added
- **Conversation-first shell** — the app now opens like Claude Desktop / ChatGPT Codex: session history in a left sidebar, transcript center-stage, composer at the bottom, and a model picker top-right in the header. Sessions/Agents/Inbox/Engine are demoted from top-level pages to drawers/panels opened from the bottom nav rail.
- **Softer neutral retheme** — warm neutral palette (dark `#1a1a18` / light `#f5f4f1`), rounded corners (12px buttons/cards, pill composer), comfortable spacing, clean light/dark across the whole app.
- **Automatic local-model detection** — scans for running local AI endpoints (Ollama, LM Studio, llama.cpp, any OpenAI-compatible server) on the common ports, lists their models with friendly names in the model picker under a "Local servers" section, with a re-scan control. No manual URL typing.
- **Agent profiles & runtime modes** — the Gauntlet baseline profile (goal+bar first, blind self-review, check-before-build probes, plain-English reporting with honest evidence markers) plus DeepSeek Harness-style runtime modes (Standard / Minimal / Creator) that compose which model, tools, skills, and safety each profile uses. Selectable in-app via the header profile chip; persists across restarts.
- **Trajectory event log** — append-only per-session event log ("every run is traceable") with a Trajectory panel that searches, filters, replays step-by-step, resumes, and forks any session's event stream.
- **Code Mode (the next DeepSeek Harness mode)** — a new agent profile + runtime mode that exposes the agent's tools through a typed TypeScript SDK, so the agent writes ONE program that calls many tools in a single step instead of dozens of separate tool round-trips. Selectable from the same header profile chip as Standard/Minimal/Creator; selecting it visibly changes the composer hint, the composition summary, and (in demo mode) the simulated responses. The SDK renders **deterministically** — lexicographic tool order, byte-identical output for an unchanged tool set, unsupported schemas degrade instead of throwing — from a **live tool registry** built from built-in tools plus extension/MCP tools and skills surfaced by the existing runtime-info calls (`getRuntimeInfo` / `getExtensions` / `testMcpServer`). A **run_code program view** decomposes one program into its individual tool-call cards (the same cards the chat renders) and records the program + every call in the Trajectory log — searchable, resumable, forkable like any session. Demo-mode simulation makes the whole flow work and testable without a live engine.

### Known limitations
- **run_code is demo-mode only** — the daemon contract has no seam for a sandboxed TypeScript runtime (no contract method can host or stream arbitrary TS execution), and the contract is off-limits for this release. Code Mode therefore ships the complete demo-mode experience: programs are simulated, every output is clearly labeled simulated, and the SDK section renders from whatever the live runtime reports. Wiring a real sandboxed runtime requires a daemon/bridge/contract change (a future release).

### Changed
- **Version** — 0.6.0 → 0.7.0 (package.json, tauri.conf.json, Cargo.toml) so the About tab matches the sidebar's release literal.

### Fixed
- **Settings e2e About-tab version assertion** — `verify/cua/settings.test.mjs` still asserted the app version `0.6.0` after the 0.7.0 bump, so the SETTINGS suite failed against the current build. Updated to `0.7.0`.

### Tests
- Unit tests — 1029 pass (up from 984), `tsc --noEmit` clean. New coverage: the SDK renderer (determinism, degradation, type-stripped contract), the tool registry, the demo decomposition (program builder, decomposer, store reducer, both demo paths), and the code profile.
- cua-driver e2e — all 7 suites stay green against the rebuilt app: SMOKE, SESSIONS, AGENTS, CHAT (11/11), INBOX, SETTINGS, SHELL (6/6). The chain runner occasionally hits WebView2 launch/timing flakes on this machine (documented harness behavior) — each suite was also verified green standalone.
- Visual regression — baselines refreshed to the v0.7 look; 5/5 views within the 0.1% threshold.

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