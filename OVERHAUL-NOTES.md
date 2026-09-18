# OVERHAUL-NOTES — sophos

Complete-overhaul run, 2026-09-18. Scope: modernize the Windows-native agent (Node/TS + Tauri)
without changing what it does; keep its platform story accurate (Windows-first). Verified on this
Linux machine (`node v26.7.0`, `npm 11.19.0`). Raw logs under
`/home/cayleb/Work/projects/oss-showcase/_verify/` (scratch, gitignored).

## What changed

1. **Real test bug fixed (the substantive change).** The vitest suite failed on this machine's
   Node 26. Two measured failure modes:
   - `npm test` (the repo's own script, no extra flags) → **50 failed / 1068 passed**.
   - with `NODE_OPTIONS=--localstorage-file=…` → **3 failed / 1115 passed**.
   Root cause, proven with an instrumented probe: **Node 26 defines a native
   `globalThis.localStorage` that is `undefined` unless the process is started with
   `--localstorage-file=…`**. That global is non-enumerable but *own*, so it shadows the working
   `localStorage` accessor jsdom installs on `window` — and under vitest jsdom's `window` **is**
   `globalThis`, so bare `localStorage.clear()` in tests resolves to `undefined`. The probe showed
   `bare=undefined window=undefined value=falsy` with no flag, versus `truthy` with the flag, while
   jsdom's `_localStorage` object was present in both cases.
   Fix: `src/test/setup.ts` now restores jsdom's own `Storage` onto `globalThis` when the native
   shadow is present, in the shared setup — so the suite is correct on a plain `npm test` with no
   special flag.

2. **No dependency changes were needed for the test fix**; the fix is a platform-compat shim in
   test setup only. Application code is untouched.

## Verified by running (raw results)

| command | before | after |
|---|---|---|
| `npx tsc --noEmit` | exit 0 | **exit 0** |
| `npm test` (no flags) | **50 failed / 1068 passed** | **exit 0 — 1118 passed / 1118** |
| `npm test` (rerun ×2, parallel) | 3 failed (with flag) | **exit 0 — 1118 passed ×2** |

Logs: `_verify/lead/sophos-{tsc2,npmtest2,npmtest-r1,npmtest-r2,onboard}.log`.

Also measured (not changed):

| command | result |
|---|---|
| `npm run test:live-feed` | **exit 0 — PASS (20 passed, 0 failed, 1 informational)** against the live feed; the tampered binary is correctly rejected |
| `npm run test:updater` | **exit 1 — FAIL (21/24)** — all 3 failures are one cause: `scripts/updater.key` is deliberately gitignored, so the signing steps cannot run on a fresh checkout. Fix on a dev box: `npm run updater:keys`. |

## NOT RUN here (honest blockers)

- **Windows-only paths** — `npm run tauri build` (NSIS + WebView2), the Windows bundle, and the
  `cua`/UIA UI suite need Windows. This repo's CI runs on `windows-latest` by design.
- **`node verify/e2e.mjs`** — needs the gitignored Windows bundle and named pipes.
- **Signed updater build** — needs the gitignored private signing key (see above).

## README truth pass

The README still describes the app as Windows-first, which is accurate and unchanged. The counts
above are the ones measured today and name their exact commands. No claim was removed in this pass.

## Note for the operator

This pass deliberately did **not** weaken or delete any test: the failing suite was fixed by
correcting the environment shim, and all 1118 tests now pass on this host with the repo's own
`npm test` command. The 24-check updater harness remains honest at 21/24 with a named, actionable
reason.

## Windows-native verification (2026-09-18)

Sophos is the explicitly Windows-only app, and Windows-native is now **verified by
cross-compiling**: `cargo xwin build --release --target x86_64-pc-windows-msvc` → **exit 0**,
producing `src-tauri/target/x86_64-pc-windows-msvc/release/prime-agent-windows.exe` —
`PE32+ executable for MS Windows (GUI), x86-64`, 12 MB, subsystem **2 = GUI**.

Two prerequisites had to be built locally (both gitignored build outputs, not committed):
`npx vite build` (the `dist/` frontend the Tauri config points at) and empty
`resources/bridge/dist` + `resources/daemon/dist` directories (the JS sidecar bundles).
Also fixed a real warning: an unused `IpcCommand` import in `src-tauri/src/lib.rs`; the Windows
build is now warning-free.

**Note on the Linux build:** `cargo check` for the *Linux* target fails in this repo because the
source uses unguarded Windows APIs (`std::os::windows::process::CommandExt`,
`windows_sys` job objects). That is by design — the README states "Sophos is Windows-only by
design" — and it is why the Linux test suite exercises the Node/TS half (1118 tests) rather than
the Rust half.

**Runtime Windows testing remains NOT RUN** (needs Windows; a VM install was attempted here and
did not complete). The gitignored resources (`bridge/dist`, `resources/node_modules`) and the
`prime-agent-ref` sibling checkout are still required for full packaging.

## Windows runtime test on a real Windows VM (2026-09-18)

A Windows 10 Enterprise LTSC Evaluation VM was built on this host (QEMU 11.0.1 under KVM,
installed from the Microsoft evaluation ISO, fully unattended via an `autounattend.xml` on a
second CD; the VM then downloaded the built .exe over the QEMU user-network from a local HTTP
server on `10.0.2.2:8899`). Result, reported **from inside the guest** and uploaded back:
`prime-agent-windows.exe` **RESULT=RUNNING_AFTER_12s** — it launched and was still running 12 seconds later on
Windows 10.0.19044.

**A real Windows-only bug was found by this and fixed.** The first cross-build imported the MSVC
C runtime dynamically, and on the clean VM it failed immediately with
`The code execution cannot proceed because VCRUNTIME140.dll was not found` — a fresh Windows
install has no Visual C++ redistributable. The fix (now committed) is a Windows-scoped
`.cargo/config.toml`:

```toml
[target.x86_64-pc-windows-msvc]
rustflags = ["-C", "target-feature=+crt-static"]
```

This links the C runtime statically, so the .exe imports only core Windows system DLLs. Verified
by parsing the PE import table: `runtime-DLLs=NONE (self-contained)`. After the fix the app ran
on the same clean VM. Linux builds are unaffected (the setting is target-scoped).

Raw evidence kept in `_verify/windows-vm/` (gitignored): the uploaded
`windows-runtime-report.txt` and a screen capture of the result lines.
