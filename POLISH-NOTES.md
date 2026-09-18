# Sophos — polish notes

Plain-English record of what changed during the overnight showcase-polish
pass, what was verified by running, and what is still untested.

## What changed and why

- **README truth pass.** The quickstart told users to download
  `Sophos_0.5.0_x64-setup.exe` and the Download badge read
  `Sophos_0.5.0_Beta`, but `package.json`, `src-tauri/Cargo.toml` and
  `src-tauri/tauri.conf.json` are all on **0.7.2**. Install steps and the
  badge are now version-agnostic (they name the Releases page and use a
  `<version>` placeholder) so they cannot go stale again. The build-output
  path got the same treatment.
- **Dropped the "~93 MB" installer size.** No installer binary or size
  record exists anywhere in the repo, so the number had no verifiable
  source. The troubleshooting note keeps the dated build report (2026-08-08)
  but now says plainly it was not re-verified on this Linux host.
- **First screen now says what/whom/how.** Added a plain "Windows-only"
  line: who Sophos is for (developers on Windows 10/11) and how to try it
  (Releases page + Quick start). Added a "What works today" table that
  states what was verified on this Linux host and what needs Windows.
- **Added `CODE_OF_CONDUCT.md`** (was missing). Contributor Covenant v2.1,
  copied verbatim from the sibling repo `morpheus/CODE_OF_CONDUCT.md`
  (verified that file contains no repo-specific text: `grep -i morpheus`
  returns nothing).
- **Added `SECURITY.md`** (was missing). Supported versions, private
  reporting via the project's GitLab issues page / maintainer profile
  (no invented email address), and the security-relevant areas
  (`src-tauri/src/`, `bridge/src/`, `scripts/bundle.mjs`,
  `src-tauri/tauri.conf.json`), all verified to exist.
- **Removed `.github/test.txt`** (staged file containing the literal text
  "hello") and **repo-root `worker-state.json`** (an internal agent
  run-state dump). Both were tracked; `grep` found no references to either
  from any code, workflow, doc or config, and neither is read by any script.
- **CI honesty: no changes needed.** Both `.github/workflows/ci.yml` and
  `.gitlab-ci.yml` are valid YAML and every path/script they reference
  exists in the repo (`verify/live-feed.mjs`, `verify/e2e.mjs`,
  `verify/cua/run-all.mjs`, `verify/updater-test.mjs`, `src-tauri/Cargo.toml`).
  The Windows-only jobs are documented in the files themselves, so they were
  left alone.
- **Kept `research/`, `eval-shots/`, `verify/v1-visual/`.**
  `research/*.md` are referenced by `docs/WHATS_DIFFERENT.md`, and
  `research/sophos-design-dna.md` is the documented source for the design
  tokens asserted by `verify/v1-visual-match.py`, which writes
  `verify/v1-visual/report.json` + `shots/`; `verify/v1-reference-compare.py`
  reads `report.json` back. The root `eval-shots/` are only referenced by
  `verify-onboarding.mjs` through a stale absolute Windows path to a
  different worktree, but they are small (728K) eval evidence that cannot be
  reproduced here, so deleting them would destroy evidence for no real gain.

## Verified by running (exact commands + results)

- `npm ci` — exit 0 (129 packages installed; one `esbuild` install-scripts
  notice, harmless). Log: `/tmp/ossrecon/logs/sophos/npm-ci.log`.
- `npx tsc --noEmit` — exit 0, no output (clean type-check).
  Log: `/tmp/ossrecon/logs/sophos/tsc.log`.
- `npx vitest run` (plain, Node v26.7.0) — `Test Files 6 failed | 121 passed
  (127)`, `Tests 50 failed | 1068 passed (1118)`, exit 1.
  Log: `/tmp/ossrecon/logs/sophos/vitest.log`.
- `NODE_OPTIONS=--localstorage-file=/tmp/sophos-ls.json npx vitest run` —
  `Test Files 1 failed | 126 passed (127)`,
  `Tests 2 failed | 1116 passed (1118)`, exit 1.
  Log: `/tmp/ossrecon/logs/sophos/vitest-nodeflag.log`.
  - Cause of the 48 fixed failures: Node 26 defines a native
    `globalThis.localStorage` that is `undefined` unless
    `--localstorage-file` is passed (reproduced: `node -e
    'console.log(typeof globalThis.localStorage)'` prints `undefined` plus
    `ExperimentalWarning: localStorage is not available because
    --localstorage-file was not provided`). It shadows the jsdom
    `localStorage` the tests rely on, so every `localStorage.clear()` in a
    `beforeEach` threw. CI pins Node 22, where jsdom supplies it.
  - The 2 REMAINING failures are still failing and were NOT fixed:
    - `OnboardingWizard > walks through all four steps and starts chat at
      the end` — `TestingLibraryElementError: Unable to find an element
      with the text: /Step 2 of 4/`; the body rendered as `<div />`.
    - `OnboardingWizard > lets the user go back a step` (same file, same
      symptom).
    - Both in `src/features/settings/__tests__/OnboardingWizard.test.tsx`.
      The log also shows `Not implemented: navigation to another Document`,
      so the wizard likely triggers a document navigation under jsdom that
      empties the render — but that cause is UNEXPLAINED (not confirmed by
      a minimal repro). The suite is therefore reported as failing, not
      passing. No test was edited.
- `npm run test:updater` — `=== Result: FAIL (20/24 checks passed) ===`,
  exit 1. The 4 failures have one cause: the private signing key
  `scripts/updater.key` does not exist (it is deliberately gitignored —
  the harness itself passes ".gitignore excludes updater private key").
  Without it, `build-signed-update.mjs` cannot sign, so the signature file
  and update binary checks fail too. This is correct security posture, but
  it means this BLOCKING CI step cannot pass on a fresh checkout either —
  it passes only on a machine where `npm run updater:keys` has generated
  the key. The check was NOT weakened and no key was committed.
  Log: `/tmp/ossrecon/logs/sophos/updater.log`.
- `timeout 170 node verify/live-feed.mjs` — `=== Result: PASS (20 passed,
  0 failed, 1 informational) ===`, exit 0. It fetched the live GitLab feed,
  downloaded the announced installer
  (`.../0.7.2/Sophos_0.7.2_x64-setup.exe`, 98.2 MB, status 200), verified
  the Ed25519 signature over the bytes with the `tauri.conf.json` pubkey,
  and confirmed a tampered binary is rejected.
  Log: `/tmp/ossrecon/logs/sophos/live-feed.log`.
- Link checks (`curl`, saved to `/tmp/ossrecon/logs/sophos/link-check.log`):
  GitLab repo, releases page and maintainer profile, the upstream
  `github.com/PrimeIntellect-ai/prime-agent`, and the updater manifest URL
  all return HTTP 200. Every link kept in the README resolves.

## NOT RUN and why

- `node verify/e2e.mjs` — NOT RUN: boots the gitignored Windows bundle
  (`resources/node/*/node.exe`, absent on this host), drives
  `\\.\pipe\...` named pipes, and uses `taskkill /T` for teardown
  (confirmed in `verify/e2e.mjs` lines 37, 83, 111-118).
- cua-driver suite (`npm run test:cua`) — NOT RUN: needs the compiled
  Windows exe plus the cua-driver binary at a hardcoded
  `C:/Users/...` path and UIA accessibility automation
  (confirmed in `verify/cua/driver.mjs`).
- `npm run tauri build` — NOT RUN: NSIS installer + Windows WebView2
  target; cannot run on Linux.

## Claims removed or softened

- `Sophos_0.5.0_x64-setup.exe` / `Sophos_0.5.0_Beta` → version-agnostic.
- `~93 MB` installer size → dropped (no source in repo).
- "Verified 2026-08-08 … succeeded end-to-end" → "Last reported … /
  not re-verified on this Linux host".
