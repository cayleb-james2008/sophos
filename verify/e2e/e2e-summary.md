# Sophos Browser E2E — Summary

Date: 2026-08-13T22:41:05.013Z · Mode: browser-demo (MockIpcClient) · App: owned ephemeral Vite server

## Result: PASS (37/37 passed)

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
| File-edit tool call renders a unified diff (not raw JSON) | ✅ PASS | ok |
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
