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
- `node verify/cua/chat.test.mjs` — cua-driver e2e for ALL Chat features.
- `node verify/cua/inbox.test.mjs` — cua-driver e2e for ALL Inbox features.
- `node verify/cua/settings.test.mjs` — cua-driver e2e for ALL Settings features.
- `node verify/cua/shell.test.mjs` — cua-driver e2e for ALL shell / global features.
- `node verify/cua/run-all.mjs` — runs all 8 suites in sequence, exits 0 on all-pass / 1 on any fail.
- `npm run test:cua` — same as above (npm script alias).
- `npx vitest run` — 1113 unit tests pass (no regressions).
- `npx tsc --noEmit` — clean.

## CI integration

The cua-driver e2e suite runs on **every push and pull request** in both
CI systems. A failure **blocks the merge** — the e2e job is not best-effort.

### How it works in CI

CI builds the app from source, installs the cua-driver, and runs the full
suite in demo mode. The build chain is:

1. **Install dependencies** — `npm ci` (Node) + Rust toolchain setup.
2. **Build the frontend** — `npm run build` (TypeScript compile + Vite build → `dist/`).
3. **Build the Tauri release exe** — `cargo build --release` in `src-tauri/`
   compiles the Rust shell and embeds the frontend. This produces
   `src-tauri/target/release/prime-agent-windows.exe` — the raw exe is all
   the e2e tests need (the full installer bundle is not required).
4. **Install cua-driver** — `irm https://cua.ai/driver/install.ps1 | iex`
   downloads and installs the cua-driver binary.
5. **Run the e2e suite** — `node verify/cua/run-all.mjs` runs all 7 test
   suites sequentially. Exit 0 = all pass, exit 1 = any fail. No
   `continue-on-error` / `allow_failure` — a failure reds the pipeline.

### GitHub Actions (`.github/workflows/ci.yml`)

The `cua-e2e` job runs on `windows-latest` alongside the existing `test` job
(tsc + vitest + best-effort e2e.mjs). The `cua-e2e` job is blocking — no
`continue-on-error`. Rust is installed via `dtolnay/rust-toolchain@stable`.
WebView2 is pre-installed on GitHub-hosted Windows runners.

### GitLab CI (`.gitlab-ci.yml`)

The `cua-e2e` job runs on `saas-windows-medium-amd64` (GitLab SaaS Windows
shared runner) in the `e2e` stage. The `cua-e2e` job is blocking — no
`allow_failure`. Rust is installed via `rustup` in the job script (GitLab SaaS
Windows runners do not ship Rust). The job caches `.cargo/registry/` and
`src-tauri/target/` to speed up subsequent runs.

### Running locally (same as CI)

```bash
# 1. Build the frontend
npm run build

# 2. Build the Tauri release exe
cd src-tauri && cargo build --release && cd ..

# 3. Install cua-driver (if not already installed)
#    PowerShell:  irm https://cua.ai/driver/install.ps1 | iex

# 4. Run the full e2e suite
node verify/cua/run-all.mjs
#    or:  npm run test:cua
```

### Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| `cua-driver call ... failed to spawn` | cua-driver not installed or wrong path | Run `irm https://cua.ai/driver/install.ps1 \| iex`, or set `CUA_DRIVER_BIN` to the binary path. |
| `daemon did not become ready` | cua-driver daemon failed to start | Check `cua-driver status` in a terminal. Kill stale daemons with `cua-driver stop`. |
| `Timed out waiting for a window owned by pid` | App didn't launch or crashed on startup | Verify the exe exists at `src-tauri/target/release/prime-agent-windows.exe`. Run `npm run build` first, then `cargo build --release` in `src-tauri/`. Check that WebView2 is installed. |
| `UIA tree is empty` / no elements | WebView2 accessibility not enabled | The harness clicks the web content to enable accessibility. If it still fails, ensure the app window is not minimized. |
| Suite times out (5 min) | App hung or a test is stuck | Check the suite's screenshot in `verify/cua/screenshots/`. Re-run the individual suite file (e.g. `node verify/cua/smoke.mjs`) to isolate. |
| `cargo build --release` fails in CI | Missing Rust toolchain or MSVC | GitHub Actions: ensure `dtolnay/rust-toolchain@stable` step ran. GitLab CI: ensure the rustup install step ran. MSVC Build Tools are pre-installed on both runner types. |
| `No window with window_id` | App window was closed externally mid-test | The demo-runner retries up to 5 times on stale-window errors. If it persists, ensure no other process is killing the app. |
| cua-driver not found after install | PATH not updated in the same shell | The install script adds to PATH. In CI, the binary is at `%LOCALAPPDATA%\Programs\Cua\cua-driver\bin\cua-driver.exe`. Set `CUA_DRIVER_BIN` explicitly if needed. |

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
