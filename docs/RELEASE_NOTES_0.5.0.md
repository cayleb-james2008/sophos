# Sophos v0.5.0 (Beta)

> **⚠️ Beta Release**
>
> This is a **pre-v1.0 beta release**. All versions before v1.0 are beta. The
> auto-updater channel is labeled `beta`, and the update feed manifest carries
> a `"channel": "beta"` field so the release channel is visible to anyone
> inspecting the endpoint. Expect rough edges; report issues via the
> [issue tracker](https://gitlab.com/caylebalvarez-james/sophos/-/issues).

**Summary:** v0.5.0 brings a `/cd` command, a persistent subagent model
policy, per-child composition knobs, a keyboard-shortcuts overlay, and a
design-system polish pass that eliminated all remaining inline styles.

---

## Highlights

- **`/cd` command** — change the active session's working directory mid-session
  via a native OS folder picker. Type `/cd` in the composer, pick a folder, and
  the session moves there without restarting.
- **Persistent subagent model policy** — a new SubagentPolicyPanel in
  Settings → Subagents lets you set the default provider, model, and thinking
  level for RLM subagents, persisted across sessions.
- **Per-child composition knobs** — AgentComposer now has a collapsible
  composition panel with a thinking-level select (defaults from the subagent
  policy) and a skill multi-select.
- **Keyboard-shortcuts overlay** — press `?` or `Cmd/Ctrl+/` to see every
  registered shortcut in a styled modal with `Kbd` chips. Closes on Escape or
  backdrop click.

## What's Changed

- **Inline styles eliminated** — all 58 `style={{}}` blocks in
  feature/view/shell/design components replaced with CSS classes or CSS custom
  properties; only dynamic custom-property refs remain.
- **Design system refactor** — Card, Modal, Tooltip, ScrollArea, Tabs,
  ErrorBoundary, Text, Button, Input, Select, Kbd, Spinner, Badge, StatusDot,
  Skeleton are now className-driven via new CSS files (`primitives.css`,
  `overlay.css`, `motion.css`, `shortcuts-overlay.css`).
- **ViewScaffold** — gained optional `loading`/`error`/`onRetry`/`errorLabel`
  props with an ErrorBoundary wrapper.
- **EmptyState** — polished, reusable empty state component.
- **Error states** — chat error state upgraded to a card with a Retry button.
- **Loading states** — chat loading text replaced with a pulsing skeleton.
- **Sessions/Inbox/Graph/Goals/LongRunning** — inline styles replaced with CSS
  custom properties and classes.

### Removed

- **Share button** — removed from the chat header and command palette (was a
  non-functional placeholder). Export and Copy buttons are retained.

### Fixed

- **Settings interface** — added `subagentDefaultProvider`,
  `subagentDefaultModel`, `subagentDefaultThinking` fields (additive,
  non-breaking).

## Known Issues

- The v0.5.0 installer binary is **not yet built and signed** — the
  auto-updater manifest points at the last signed stable build until the
  v0.5.0 installer is rebuilt and re-signed. New installs should use the latest
  published installer for now; the v0.5.0 binary will be published when it is
  ready.
- As a pre-v1.0 beta, some features may be incomplete or subject to change.

## Installation

Download the installer from the GitLab release assets:

- **Windows x64 installer:**
  [Sophos_0.5.0_x64-setup.exe](https://gitlab.com/api/v4/projects/caylebalvarez-james%2Fsophos/packages/generic/sophos/0.5.0/Sophos_0.5.0_x64-setup.exe)

Or build from source — see
[CONTRIBUTING.md](https://gitlab.com/caylebalvarez-james/sophos/-/blob/master/CONTRIBUTING.md).

**Release page:** https://gitlab.com/caylebalvarez-james/sophos/-/releases/0.5.0
