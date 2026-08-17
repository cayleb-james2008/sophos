# Sophos v0.8.0 (Beta)

**Released:** 2026-08-17

Sophos v0.8.0 is the quality-and-reliability release. It ships an enforced lint + format gate, a conservative Rust startup sweep that reclaims stale session-lease debris left behind by crashes, a written record of every reliability disposition, and the removal of the last untyped `any` casts and two real Rules-of-Hooks violations from production code. It is proven against the real desktop app: all 8 cua-driver end-to-end suites pass against the rebuilt release exe, with fresh screenshots and a committed run record.

---

## What is Sophos

Sophos is a Windows-native coding agent that brings [Prime Intellect's](https://www.primeintellect.ai/) open-source coding agent to the desktop as a polished app — a Tauri v2 (Rust) shell, a Node bridge sidecar, and a React frontend styled after the Prime Intellect design language (Geist typography, terminal-green accents, near-black surfaces). The daemon does the actual AI work; the bridge translates between the daemon's event stream and the frontend's IPC; and the frontend gives you a terminal-minimal chat, session graph, fleet, inbox, engine terminal, and settings — all running locally on Windows.

---

## What's new in v0.8.0

### Added

- **Enforced lint + format gate** — ESLint 9 (flat config) with `typescript-eslint`, `react`, and `react-hooks`, plus Prettier. `npm run lint` (zero warnings), `npm run format:check`, and `npm run check` (lint + format + `tsc --noEmit`) now gate the codebase; wired into both CI systems so a dirty tree fails the build.
- **Stale session-lease recovery** — a conservative Rust startup sweep (`src-tauri/src/lease.rs`) that runs before the daemon spawns: it clears crash-leftover lease debris (`*.lock.stale-*` / `*.lock.candidate-*`) and reclaims full `*.lock` lease directories only when the `owner.json` PID is provably dead **and** past a 1-hour grace window. Missing/malformed owner data or an undeterminable PID liveness always means *keep* — the sweep never deletes on uncertainty.
- **Reliability dispositions record** — `docs/reliability-0.8.0.md` documents, for each of the five named reliability bugs, whether it is FIXED-with-a-test or REFUTED as an upstream daemon/bridge seam — with evidence, never silently open.

### Fixed

- **No untyped `any` left in production code** — the three `window as any` casts (demo-mode flag + debug IPC handle) are replaced by a typed global augmentation.
- **Two real React Rules-of-Hooks violations** — `useProfile()` called `useProfileState()` conditionally and `SessionTree` called `useMemo` after an early return; both now call hooks unconditionally.
- **Dead code removed** — unused imports and the unused `RpcEventEnvelope` type in the bridge, and an unused import in the Rust shell.
- **Hook-dependency drift** — `useAgents`, `FirstRunBanner`, and `TrajectoryProvider` now declare their real dependencies.

---

## Tests

- **Unit** — 1119 pass (up from 1118), `tsc --noEmit` clean (frontend + bridge), `eslint --max-warnings 0` clean, `prettier --check` clean.
- **Rust** — `cargo test` 25 pass (6 new `lease.rs` tests + the existing sidecar-recovery and native-session tests), zero warnings.
- **cua-driver e2e** — **8/8 suites green** against the rebuilt release exe (SMOKE 6/6, SESSIONS 8/8, AGENTS 6/6, CHAT 11 passed, INBOX 5/5, SETTINGS 10/10, SHELL 6/6, STUDIO 7/7). See `verify/cua/e2e-run-0.8.0.md` for the run record and `verify/cua/screenshots/` for fresh screenshots.
- **Update feed** — the 0.8.0 installer is signed and the `public/manifest.json` signature verifies cryptographically (minisign Ed25519 over Blake2b-512, tamper-rejection negative test confirmed).

---

## Download

| Item | Link |
|---|---|
| **NSIS installer** | `Sophos_0.8.0_x64-setup.exe` (98.2 MB, SHA-256 `6f604896…af66e46`) — attached as release asset |
| **MSI installer** | `Sophos_0.8.0_x64_en-US.msi` (168.8 MB, SHA-256 `95b942ff…1b75d`) |
| **Releases page** | [https://gitlab.com/caylebalvarez-james/sophos/-/releases](https://gitlab.com/caylebalvarez-james/sophos/-/releases) |
| **Full changelog** | [CHANGELOG.md](https://gitlab.com/caylebalvarez-james/sophos/-/blob/master/CHANGELOG.md) |

The NSIS installer bundles the portable Node runtime, daemon `dist/`, bridge `dist/`, and shared `node_modules/` — zero manual dependencies. No admin required; installs to `~\AppData\Local\Sophos`. The auto-updater ships the same binary via the signed update feed.

> **CI note:** the tag-job installer step currently skips on hosted runners — the daemon/bridge bundle is not reproducible from a fresh checkout. See [`docs/installer-reproducibility-0.8.0.md`](installer-reproducibility-0.8.0.md) for the exact blocker and the operator steps to make it build in CI.

> **⚠️ Beta Notice:** All Sophos versions before v1.0 are beta releases. Features may change, and there may be bugs. Use in production at your own risk.

---

## Screenshots

Fresh screenshots for every view are committed under `verify/cua/screenshots/`. The ready-to-paste GitLab release description — with images embedded via absolute `/-/raw/master/…` URLs so they render on the release page (relative/local paths do not) — is in [`docs/gitlab-release-v0.8.0.md`](gitlab-release-v0.8.0.md).

---

## Credits

Sophos is a Windows port of [PrimeIntellect-ai/prime-agent](https://github.com/PrimeIntellect-ai/prime-agent). All credit for the agent runtime, daemon, and bridge belongs to the Prime Intellect team.

Built by [Cayleb](https://gitlab.com/caylebalvarez-james).
