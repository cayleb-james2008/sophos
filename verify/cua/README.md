# cua-driver E2E Test Harness

A reusable end-to-end test harness that drives the **real Sophos desktop app**
(Tauri v2) through the [cua-driver](https://github.com/trycua/cua) CLI. It
launches the app, reads UIA accessibility trees, clicks elements, types text,
takes screenshots, presses keys/hotkeys, and runs tests with before/after
hooks and assertion helpers.

The cua-driver works **in the background** — it does not steal the cursor or
keyboard focus.

## Quick start

```bash
# Run the smoke test (launches the app, drives the nav views, verifies)
node verify/cua/smoke.mjs
```

Exit code `0` = all tests passed. Exit code `1` = at least one test failed.

## Prerequisites

- The cua-driver binary at
  `C:/Users/Cayleb/AppData/Local/Programs/Cua/cua-driver/bin/cua-driver.exe`
  (override with the `CUA_DRIVER_BIN` env var).
- The Sophos desktop app release build at
  `src-tauri/target/release/prime-agent-windows.exe`.
- Node.js (ESM `.mjs` modules).

The cua-driver daemon may already be running — `startDaemon()` detects it and
leaves it untouched. The runner only stops a daemon it started itself.

## Files

| File | Purpose |
|------|---------|
| `driver.mjs` | Thin wrapper around the `cua-driver call <tool>` CLI. JSON args are piped via stdin (cmd/PowerShell strip quotes otherwise). Exposes `startDaemon`, `stopDaemon`, `listWindows`, `getWindowState`, `click`, `clickElement`, `typeText`, `pressKey`, `hotkey`, `scroll`, `bringToFront`, `screenshot`, `desktopScreenshot`. |
| `launch.mjs` | App launcher. `launchApp` launches the app, waits for its window, enables WebView2 accessibility, and returns `{ pid, windowId }`. Also `findSophosWindow`, `closeApp`, `restartApp`. |
| `helpers.mjs` | Test helpers on top of driver + launch: `findElement`, `clickElement`, `navTo`, `waitForElement`, `takeScreenshot`, `getTextContent`, `toWindowLocal`. |
| `assertions.mjs` | `assert`, `assertElementVisible`, `assertElementNotVisible`, `assertTextContains`, `assertNoConsoleErrors` (placeholder). |
| `runner.mjs` | Test runner. `runSuite(name, tests)` runs `beforeAll` (start daemon + launch app), each test, then `afterAll` (final screenshot + close app + stop daemon). Sets exit code 1 on failure. |
| `smoke.mjs` | Smoke test proving the harness works end-to-end against the real app. |
| `screenshots/` | Screenshots captured by tests (e.g. `smoke-initial.png`, `final-state.png`). |

## How it works

1. **Launch** — `launchApp` calls `cua-driver call launch_app` with the app
   path, waits for the window via `list_windows`, then performs one background
   click on the web content. That click flips WebView2 into accessibility mode,
   after which the full DOM is exposed as individual UIA elements.
2. **Read the tree** — `getWindowState(pid, windowId)` returns a structured
   `elements` array (`{ element_index, element_token, role, label, frame,
   enabled, … }`) plus a `tree_markdown` rendering.
3. **Click** — `clickElement` prefers the element's `element_token` (UIA
   Invoke via PostMessage — no coordinates, no focus steal, works on
   backgrounded windows). It falls back to a pixel click at the element's
   centre bounds for canvas / custom-drawn surfaces.
4. **Verify** — `assertTextContains` / `assertElementVisible` check the UIA
   tree for expected content.

### Coordinate note

Element `frame` values from `get_window_state` are in **screen** coordinates,
while `click(x, y)` expects **window-local** pixels. `toWindowLocal()` converts
between them. Prefer `element_token` clicks whenever possible to avoid
coordinates entirely.

### Hotkeys & scroll

Tauri/Chromium surfaces drop background hotkeys and scroll events. The driver
retries with `delivery_mode: "foreground"` when the driver reports
`background_unavailable` — matching the driver's own guidance (try background
first, escalate only on the structured signal).

## Adding a new test

Create a new `.mjs` file that imports from `runner.mjs`, `helpers.mjs`, and
`assertions.mjs`:

```js
import { runSuite } from "./runner.mjs";
import { getWindowState } from "./driver.mjs";
import { navTo, takeScreenshot } from "./helpers.mjs";
import { assertTextContains } from "./assertions.mjs";

const tests = [
  {
    name: "opens Settings and shows providers",
    fn: async (app) => {
      const state = getWindowState(app.pid, app.windowId, { include_screenshot: false });
      navTo(app.pid, state, "Settings");
      await new Promise((r) => setTimeout(r, 500));
      const after = getWindowState(app.pid, app.windowId, { include_screenshot: false });
      assertTextContains(after, "SETTINGS");
    },
  },
];

await runSuite("My suite", tests);
```

Each test `fn` receives the shared app handle `{ pid, windowId }`. The runner
handles launch/teardown and reports pass/fail per test.

## Verification

- `node verify/cua/smoke.mjs` — exit 0, reports PASS.
- `node verify/cua/sessions.test.mjs` — cua-driver e2e for ALL Sessions features.
- `node verify/cua/agents.test.mjs` — cua-driver e2e for ALL Agents features.
- `npx vitest run` — 982 unit tests pass (no regressions).
- `npx tsc --noEmit` — clean.

## Demo mode

The Sophos desktop app normally talks to a live daemon/provider. Without one
configured, Sessions/Agents show degraded empty states, so the full UI can't be
exercised. To make the app demonstrable and testable by computer-use without a
provider, the app supports **demo mode**: launching the release build with
`--demo` (or `SOPHOS_DEMO_MODE=1`) makes the Rust shell skip the daemon +
sidecar and inject `window.__SOPHOS_DEMO__ = true`, so the frontend uses the
`MockIpcClient` (the same simulated sessions, agents, and messages the browser
preview uses). See `demo-launch.mjs` / `demo-runner.mjs`.

The Session/Agent e2e suites run in demo mode and exercise every feature
against the simulated data:

- **Sessions**: graph view (nodes + edges), tree view, detail inspector, new
  session, resume, fork, clone, switch.
- **Agents**: fleet graph, RLM children, attach, detach, send message, and
  composition knobs.

Note: `find-util.mjs` provides correct `findBy` / `clickBy` / `waitFor` helpers.
The harness's `helpers.findElement` has an inverted text filter (it always
returns the first role/name match, ignoring `text`), so the suites use
`find-util.mjs` instead of the buggy helpers.
