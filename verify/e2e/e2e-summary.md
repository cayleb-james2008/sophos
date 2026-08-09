# Sophos Browser E2E — Summary

Date: 2026-08-09T21:13:52.491Z · Mode: browser-demo (MockIpcClient) · App: `npm run dev` on :1420

## Result: PASS (36/36 passed)

## Views

| Test | Result | Detail |
|---|---|---|
| Chat view renders | ✅ PASS | ok |
| Sessions view renders graph + inspector | ✅ PASS | ok |
| Sessions detail inspector opens on node select | ✅ PASS | ok |
| Sessions tree view switch | ✅ PASS | ok |
| Agents view renders fleet graph + RLM children | ✅ PASS | ok |
| Inbox view renders empty relay state | ✅ PASS | ok |
| Settings General panel renders form | ✅ PASS | ok |
| Settings Providers panel renders catalog | ✅ PASS | ok |
| Settings Skills panel renders | ✅ PASS | ok |
| Settings Advanced runtime telemetry renders | ✅ PASS | ok |
| Settings Long-running panels render (Goals/Autonomous/Heartbeats/Schedules/Refinement) | ✅ PASS | ok |
| Engine terminal opens via SystemBar toggle | ✅ PASS | ok |

## Flows

| Test | Result | Detail |
|---|---|---|
| Send a message → user msg + streaming assistant + completes | ✅ PASS | ok |
| Steering (Enter while busy) shows steered indicator | ✅ PASS | ok |
| Follow-up queue (Alt+Enter) drains one at a time | ✅ PASS | ok |
| Abort mid-stream (Stop button) clears busy | ✅ PASS | ok |
| Side question (/btw) opens inline panel and completes | ✅ PASS | ok |
| Command palette (⌘K) opens, lists commands, closes | ✅ PASS | ok |
| Model selector switches model | ✅ PASS | ok |
| Provider login flow (Connect → modal → submit → connected) | ✅ PASS | ok |
| Managed provider exposes a copyable OAuth link + API-key alternative | ✅ PASS | ok |
| Provider logout does not error | ✅ PASS | ok |
| Export session shows toast | ✅ PASS | ok |
| Session Resume / Fork actions from detail | ✅ PASS | ok |
| New session modal opens from Chat header | ✅ PASS | ok |

## Edge

| Test | Result | Detail |
|---|---|---|
| Empty / whitespace input disables send | ✅ PASS | ok |
| Escape clears composer text when idle | ✅ PASS | ok |
| @ file-reference hint popover appears | ✅ PASS | ok |
| Shell command (!cmd) shows shell notice | ✅ PASS | ok |
| Busy state shows streaming indicator + stop control | ✅ PASS | ok |
| Engine-disconnected (demo) banner present in browser mode | ✅ PASS | ok |
| Agents view renders RLM children fleet (non-empty) | ✅ PASS | ok |
| Inbox view empty state (no relay traffic) | ✅ PASS | ok |
| Error handling: IPC rejection shows error UI + Retry recovers | ✅ PASS | ok |
| Empty transcript state in session detail | ✅ PASS | ok |
| No console/page errors across all views | ✅ PASS | ok |

## Evidence

- JSON report: `verify/e2e/e2e-report.json`
- Screenshots: `verify/e2e/screenshots/`
  - `C:/Users/Cayleb/Desktop/workspace/prime-agent-windows/verify/e2e/screenshots/Views-chat-view-renders-chat.png`
  - `C:/Users/Cayleb/Desktop/workspace/prime-agent-windows/verify/e2e/screenshots/Views-sessions-view-renders-graph-inspector-sessions.png`
  - `C:/Users/Cayleb/Desktop/workspace/prime-agent-windows/verify/e2e/screenshots/Views-sessions-detail-inspector-opens-on-node-select-sessions-detail.png`
  - `C:/Users/Cayleb/Desktop/workspace/prime-agent-windows/verify/e2e/screenshots/Views-sessions-tree-view-switch-sessions-tree.png`
  - `C:/Users/Cayleb/Desktop/workspace/prime-agent-windows/verify/e2e/screenshots/Views-agents-view-renders-fleet-graph-rlm-children-agents.png`
  - `C:/Users/Cayleb/Desktop/workspace/prime-agent-windows/verify/e2e/screenshots/Views-inbox-view-renders-empty-relay-state-inbox.png`
  - `C:/Users/Cayleb/Desktop/workspace/prime-agent-windows/verify/e2e/screenshots/Views-settings-general-panel-renders-form-settings-general.png`
  - `C:/Users/Cayleb/Desktop/workspace/prime-agent-windows/verify/e2e/screenshots/Views-settings-providers-panel-renders-catalog-settings-providers.png`
  - `C:/Users/Cayleb/Desktop/workspace/prime-agent-windows/verify/e2e/screenshots/Views-settings-skills-panel-renders-settings-skills.png`
  - `C:/Users/Cayleb/Desktop/workspace/prime-agent-windows/verify/e2e/screenshots/Views-settings-advanced-runtime-telemetry-renders-settings-advanced.png`
  - `C:/Users/Cayleb/Desktop/workspace/prime-agent-windows/verify/e2e/screenshots/Views-settings-long-running-panels-render-goals-autonomous-heartbeats-schedules-refinement--settings-longrunning.png`
  - `C:/Users/Cayleb/Desktop/workspace/prime-agent-windows/verify/e2e/screenshots/Views-engine-terminal-opens-via-systembar-toggle-engine.png`
  - `C:/Users/Cayleb/Desktop/workspace/prime-agent-windows/verify/e2e/screenshots/Flows-send-a-message-user-msg-streaming-assistant-completes-flow-send-busy.png`
  - `C:/Users/Cayleb/Desktop/workspace/prime-agent-windows/verify/e2e/screenshots/Flows-send-a-message-user-msg-streaming-assistant-completes-flow-send-done.png`
  - `C:/Users/Cayleb/Desktop/workspace/prime-agent-windows/verify/e2e/screenshots/Flows-steering-enter-while-busy-shows-steered-indicator-flow-steer.png`
  - `C:/Users/Cayleb/Desktop/workspace/prime-agent-windows/verify/e2e/screenshots/Flows-follow-up-queue-alt-enter-drains-one-at-a-time-flow-followup-queued.png`
  - `C:/Users/Cayleb/Desktop/workspace/prime-agent-windows/verify/e2e/screenshots/Flows-follow-up-queue-alt-enter-drains-one-at-a-time-flow-followup-drained.png`
  - `C:/Users/Cayleb/Desktop/workspace/prime-agent-windows/verify/e2e/screenshots/Flows-abort-mid-stream-stop-button-clears-busy-flow-abort.png`
  - `C:/Users/Cayleb/Desktop/workspace/prime-agent-windows/verify/e2e/screenshots/Flows-side-question-btw-opens-inline-panel-and-completes-flow-sidequestion.png`
  - `C:/Users/Cayleb/Desktop/workspace/prime-agent-windows/verify/e2e/screenshots/Flows-command-palette-k-opens-lists-commands-closes-flow-palette.png`
  - `C:/Users/Cayleb/Desktop/workspace/prime-agent-windows/verify/e2e/screenshots/Flows-model-selector-switches-model-flow-model.png`
  - `C:/Users/Cayleb/Desktop/workspace/prime-agent-windows/verify/e2e/screenshots/Flows-provider-login-flow-connect-modal-submit-connected--flow-login-modal.png`
  - `C:/Users/Cayleb/Desktop/workspace/prime-agent-windows/verify/e2e/screenshots/Flows-provider-login-flow-connect-modal-submit-connected--flow-login-connected.png`
  - `C:/Users/Cayleb/Desktop/workspace/prime-agent-windows/verify/e2e/screenshots/Flows-managed-provider-exposes-a-copyable-oauth-link-api-key-alternative-flow-oauth-copy-link.png`
  - `C:/Users/Cayleb/Desktop/workspace/prime-agent-windows/verify/e2e/screenshots/Flows-managed-provider-exposes-a-copyable-oauth-link-api-key-alternative-flow-oauth-copied.png`
  - `C:/Users/Cayleb/Desktop/workspace/prime-agent-windows/verify/e2e/screenshots/Flows-provider-logout-does-not-error-flow-provider-logout.png`
  - `C:/Users/Cayleb/Desktop/workspace/prime-agent-windows/verify/e2e/screenshots/Flows-export-session-shows-toast-flow-export.png`
  - `C:/Users/Cayleb/Desktop/workspace/prime-agent-windows/verify/e2e/screenshots/Flows-session-resume-fork-actions-from-detail-flow-session-actions.png`
  - `C:/Users/Cayleb/Desktop/workspace/prime-agent-windows/verify/e2e/screenshots/Flows-new-session-modal-opens-from-chat-header-flow-new-session.png`
  - `C:/Users/Cayleb/Desktop/workspace/prime-agent-windows/verify/e2e/screenshots/Edge-empty-whitespace-input-disables-send-edge-empty-input.png`
  - `C:/Users/Cayleb/Desktop/workspace/prime-agent-windows/verify/e2e/screenshots/Edge-escape-clears-composer-text-when-idle-edge-escape-clear.png`
  - `C:/Users/Cayleb/Desktop/workspace/prime-agent-windows/verify/e2e/screenshots/Edge--file-reference-hint-popover-appears-edge-file-hint.png`
  - `C:/Users/Cayleb/Desktop/workspace/prime-agent-windows/verify/e2e/screenshots/Edge-shell-command-cmd-shows-shell-notice-edge-shell.png`
  - `C:/Users/Cayleb/Desktop/workspace/prime-agent-windows/verify/e2e/screenshots/Edge-busy-state-shows-streaming-indicator-stop-control-edge-busy.png`
  - `C:/Users/Cayleb/Desktop/workspace/prime-agent-windows/verify/e2e/screenshots/Edge-engine-disconnected-demo-banner-present-in-browser-mode-edge-demo-banner.png`
  - `C:/Users/Cayleb/Desktop/workspace/prime-agent-windows/verify/e2e/screenshots/Edge-agents-view-renders-rlm-children-fleet-non-empty--edge-agents-fleet.png`
  - `C:/Users/Cayleb/Desktop/workspace/prime-agent-windows/verify/e2e/screenshots/Edge-inbox-view-empty-state-no-relay-traffic--edge-inbox-empty.png`
  - `C:/Users/Cayleb/Desktop/workspace/prime-agent-windows/verify/e2e/screenshots/Edge-error-handling-ipc-rejection-shows-error-ui-retry-recovers-edge-error-state.png`
  - `C:/Users/Cayleb/Desktop/workspace/prime-agent-windows/verify/e2e/screenshots/Edge-error-handling-ipc-rejection-shows-error-ui-retry-recovers-edge-error-recovered.png`
  - `C:/Users/Cayleb/Desktop/workspace/prime-agent-windows/verify/e2e/screenshots/Edge-empty-transcript-state-in-session-detail-edge-empty-transcript.png`
  - `C:/Users/Cayleb/Desktop/workspace/prime-agent-windows/verify/e2e/screenshots/Edge-no-console-page-errors-across-all-views-edge-error-sweep.png`
