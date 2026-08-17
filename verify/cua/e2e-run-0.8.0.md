# cua-driver e2e — v0.8.0 release run record

**Date:** 2026-08-17
**Release exe:** `src-tauri/target/release/prime-agent-windows.exe` (rebuilt 12:44, SHA-256 `cec372d4ba0a3079d664d8ee3f331355b5a2d7733a525a3eff097a5ee9f8fd6d`)
**Runner:** `node verify/cua/run-all.mjs` (600s per-suite timeout)
**Result:** **8/8 suites PASS** (0 failed, 0 timed out)

| Suite | Result | Tests |
|---|---|---|
| SMOKE | PASS | 6/6 |
| SESSIONS | PASS | 8/8 |
| AGENTS | PASS | 6/6 |
| CHAT | PASS | 11 passed (2 documented SKIPs) |
| INBOX | PASS | 5/5 |
| SETTINGS | PASS | 10/10 |
| SHELL | PASS | 6/6 (1 documented SKIP) |
| STUDIO | PASS | 7/7 |

**Total:** 59 tests passed, 3 documented SKIPs, 0 failures — 1089571ms (~18m).

## Documented SKIPs (background-WebView2 input limitations, unit-covered)

- CHAT — "Steering: steered indicator did not appear" (keyboard delivery intermittent in backgrounded WebView2; unit-validated in `mockChatTurn.test.ts`).
- CHAT — "Slash select: composer did not fill" (click-select intermittent in backgrounded WebView2).
- SHELL — "shortcuts overlay" (cua-driver cannot inject keyboard into WebView2; covered by `shortcutsOverlay.test.tsx`).

## Harness reliability changes (shipped with this release)

- The CHAT suite now drives the **release** build (previously preferred the debug build as a temporary workaround while the release exe was stale).
- Per-suite timeout raised 5 → 10 minutes in `run-all.mjs`: CHAT (~4.5m) and STUDIO (~5m) legitimately run long, and a single WebView2 timing-flake retry could previously redden an otherwise-passing run.
- `launch.mjs` now retries the initial UIA read (like the demo suites already did) so a brief post-launch "UIA provider unresponsive" timeout no longer sinks SMOKE.

Fresh screenshots for every suite are committed under `verify/cua/screenshots/`.
