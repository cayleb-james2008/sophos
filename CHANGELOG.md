# Changelog

All notable changes to Sophos are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] — 2026-08-14

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

## [0.1.0] — 2026-08-12

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