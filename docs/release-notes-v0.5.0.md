# Sophos v0.5.0 (Beta)

**Released:** 2026-08-15

Sophos v0.5.0 focuses on composition and polish. You can now change the active session's working directory mid-chat with a native `/cd` picker, configure a persistent default model and thinking level for RL subagents, and fine-tune per-child composition with a new collapsible panel and a keyboard-shortcuts overlay. Under the hood, the entire design system was refactored to CSS classes and custom properties — eliminating all 58 inline `style` blocks — and the test suite grew from 86 to 106 passing tests.

---

## What is Sophos

Sophos is a Windows-native coding agent that brings [Prime Intellect's](https://www.primeintellect.ai/) open-source coding agent to the desktop as a polished app — a Tauri v2 (Rust) shell, a Node bridge sidecar, and a React frontend styled after the Prime Intellect design language (Geist typography, terminal-green accents, sharp corners, near-black surfaces). The daemon does the actual AI work; the bridge translates between the daemon's event stream and the frontend's IPC; and the frontend gives you a terminal-minimal chat, session graph, fleet, inbox, and settings — all running locally on Windows.

---

## What's new in v0.5.0

### Added

- **`/cd` command** — change the active session's working directory mid-session via a native directory picker (typed `/cd` in the composer, opens OS folder dialog, calls `runCommand("cd")`).
- **Persistent subagent model policy** — new `SubagentPolicyPanel` in Settings → Subagents: set default provider, model, and thinking level for RLM subagents, persisted across sessions via `setSettings`.
- **Per-child composition knobs** — AgentComposer now has a collapsible composition panel with a thinking level select (defaults from subagent policy) and a skill multi-select (from the daemon catalog minus disabled skills).
- **Keyboard shortcuts overlay** — press `?` or `Cmd/Ctrl+/` to see all registered shortcuts in a styled modal with Kbd chips; closes on Escape/backdrop click.
- **ShortcutsOverlay component** — new design-system modal listing all `Hotkey` entries from the `useHotkeys` registry, grouped by category.

### Changed

- **Inline styles eliminated** — all 58 `style={{}}` blocks in feature/view/shell/design components replaced with CSS classes or CSS custom properties; only dynamic CSS custom property refs remain (e.g. `--pa-skeleton-w`, `--ctx`, `--pad`).
- **Design system refactor** — Card, Modal, Tooltip, ScrollArea, Tabs, ErrorBoundary, Text, Button, Input, Select, Kbd, Spinner, Badge, StatusDot, Skeleton are all className-driven via new CSS files (`primitives.css`, `overlay.css`, `motion.css`, `shortcuts-overlay.css`).
- **ViewScaffold** — gained optional `loading`/`error`/`onRetry`/`errorLabel` props with an ErrorBoundary wrapper.
- **EmptyState** — polished, reusable empty state component with icon, title, description, and optional action button.
- **Error states** — chat error state upgraded to a card with a Retry button (disabled when there's no assistant turn to retry).
- **Loading states** — chat loading text replaced with a pulsing skeleton.
- **Sessions/Inbox/Graph/Goals/LongRunning** — all inline styles replaced with CSS custom properties (`--node-w`, `--node-color`, `--bar-w`, `--fill-w`, `--depth`, `--ring-size`, `--chevron-rot`) and CSS classes (`.card-stack-lg`, `.goals-panel`).

### Removed

- **Share button** — removed from the chat header and command palette (it was non-functional, "not available yet"); Export and Copy buttons retained.

### Fixed

- **Settings interface** — added `subagentDefaultProvider`, `subagentDefaultModel`, `subagentDefaultThinking` fields (additive, non-breaking).

### Tests

- **106 tests pass** (9 files), up from an 86 baseline — added 20 new tests: `/cd` command (8), subagent policy (6), ShortcutsOverlay (6).

---

## Download

| Item | Link |
|---|---|
| **Installer** | `Sophos_0.5.0_x64-setup.exe` (attached as release asset) |
| **Releases page** | [https://gitlab.com/caylebalvarez-james/sophos/-/releases](https://gitlab.com/caylebalvarez-james/sophos/-/releases) |
| **Full changelog** | [CHANGELOG.md](https://gitlab.com/caylebalvarez-james/sophos/-/blob/main/CHANGELOG.md) |

The installer bundles the portable Node runtime, daemon `dist/`, bridge `dist/`, and shared `node_modules/` — zero manual dependencies. No admin required; installs to `~\AppData\Local\Sophos`.

> **⚠️ Beta Notice:** All Sophos versions before v1.0 are beta releases. Features may change, and there may be bugs. Use in production at your own risk.

---

## Credits

Sophos is a Windows port of [PrimeIntellect-ai/prime-agent](https://github.com/PrimeIntellect-ai/prime-agent). All credit for the agent runtime, daemon, and bridge belongs to the Prime Intellect team.

Built by [Cayleb](https://gitlab.com/caylebalvarez-james).
