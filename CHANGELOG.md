# Changelog

All notable changes to Sophos are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- ErrorBoundary component in the design system — catches render errors with a token-styled fallback UI
- Skeleton primitive in the design system — pulse-animation loading placeholder
- Keyboard shortcut registry (`useHotkeys` hook) for global shortcut registration
- App-level state context to reduce prop-drilling across views

### Changed
- All 65 raw `<button>` elements in feature components replaced with design-system `<Button>`/`<IconButton>` primitives
- All inline hex color literals in feature components replaced with token references

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
- Built by [Cayleb](https://github.com/cayleb-james2008).