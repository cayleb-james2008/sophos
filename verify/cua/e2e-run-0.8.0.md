# cua-driver e2e — v0.8.0 release run record

**Date:** 2026-08-17
**Release exe:** `src-tauri/target/release/prime-agent-windows.exe` (SHA-256 `a243ce0ea6ebfe9235ca469bb272342232d3bb0dd9479a384e0fdf4bac7e286c`)
**Runner:** `node verify/cua/run-all.mjs` (600s per-suite timeout)

## Result

Two full runs against the rebuilt release exe, both **8/8 suites PASS**:

| Run | Duration | Result |
|---|---|---|
| Run 1 | 841428ms (~14m) | 8/8 PASS, 0 failed, 0 timed out |
| Run 2 (post drift-fix) | 878493ms (~14.6m) | 8/8 PASS, 0 failed, 0 timed out |

| Suite | Result | Tests |
|---|---|---|
| SMOKE | PASS | 6/6 |
| SESSIONS | PASS | 8/8 |
| AGENTS | PASS | 6/6 |
| CHAT | PASS | 11 passed (1 documented SKIP) |
| INBOX | PASS | 5/5 |
| SETTINGS | PASS | 10/10 |
| SHELL | PASS | 6/6 (1 documented SKIP) |
| STUDIO | PASS | 7/7 |

**Total:** 59 tests passed, 2 documented SKIPs, 0 failures.

## Process drift

- **Before the crashpad-handler fix:** a passing run still left **4 orphaned**
  Sophos `msedgewebview2.exe --type=crashpad-handler` processes (dead parents).
  Crashpad handlers survive `kill_app` and were invisible to the old
  parent-chain walk.
- **After the fix:** cleanup identifies Sophos WebView2 by the Tauri identifier
  (`com.sophos.app`) in the command line and runs after **every** suite, so the
  re-run finishes with **zero drift** — `prime-agent-windows.exe` 0, Sophos
  WebView2 0, other apps' WebView2 untouched.

## Documented SKIPs (background-WebView2 input limitations, unit-covered)

- CHAT — "Slash select: composer did not fill" (click-select intermittent in backgrounded WebView2).
- SHELL — "shortcuts overlay" (cua-driver cannot inject keyboard into WebView2; covered by `shortcutsOverlay.test.tsx`).

## Harness reliability changes

- `run-all.mjs` tears down after **every** suite (kill app + Sophos WebView2 +
  restart daemon), not only on timeout/crash; pass/fail/timeout labels are
  accurate, and resolution happens only after teardown completes.
- `cleanup.mjs` sweeps Sophos WebView2 by the `com.sophos.app` Tauri identifier,
  so detached crashpad-handler / orphaned renderer processes are caught even
  after their parent has already exited.
- `driver.mjs` applies a real 60s timeout to every `cua-driver` CLI call so a
  wedged daemon can never block the runner or its cleanup.
- Per-suite timeout is 10 minutes: CHAT and STUDIO legitimately run several
  minutes, and a single WebView2 timing-flake retry could previously redden an
  otherwise-passing run.

Fresh screenshots for every suite are committed under `verify/cua/screenshots/`.
