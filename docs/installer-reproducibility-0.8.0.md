# Installer reproducibility — v0.8.0 tag-job blocker

**Date:** 2026-08-17
**Status:** OPEN — the NSIS installer step of the tag CI job skips on hosted
runners because the runtime bundle is not reproducible from a fresh checkout.

## What the tag job needs vs. what a fresh runner has

`npm run tauri build` bundles the Tauri resource dir, which must contain four
things. `scripts/bundle.mjs` assembles them, but three of the four come from
machine-local sources that a hosted runner does not have:

| Runtime input | `bundle.mjs` source | Size | On a fresh runner? |
|---|---|---|---|
| `resources/daemon/dist/cli.js` | `prime-agent-ref/packages/coding-agent/dist` (built) | 34 MB / 1181 files | ✗ gitignored `dist/` |
| `resources/node_modules/@earendil-works/*` | `prime-agent-ref/packages/{agent,ai,coding-agent,tui}` | ~42 MB built | ✗ gitignored |
| `resources/node_modules` (external deps) | `%LOCALAPPDATA%\Prime Agent\node_modules` | ~500 MB (native `zeromq`) | ✗ machine-local |
| `resources/node/…/node.exe` | tracked runtime dir, exe gitignored | ~90 MB | ✗ `.exe` gitignored |

## Why the daemon isn't reproducible

The daemon + bridge source lives in the sibling `prime-agent-ref` checkout, and
its current state is local-only:

- **Remote** is upstream `https://github.com/PrimeIntellect-ai/prime-agent.git`;
  no fork remote is configured. `git rev-list --left-right --count
  origin/main...HEAD` → `0 1`.
- **Unpushed commit `12e816e`** — "daemon: TCP-loopback fallback transport
  (gated on PRIME_DAEMON_TCP / tcp:// spec); named-pipe default unchanged".
  This is the TCP support the bridge relies on.
- **14 uncommitted modified files** — `kernel/index.ts` (+112),
  `kernel/state-snapshot.ts` (+43), `agent-session.ts` (+46),
  `ai/src/models.generated.ts` (±762), `tools/ipython.ts`, plus daemon and
  agent-connection tweaks. A diff grep found no `isTcpDaemonSocketSpec` /
  `PRIME_DAEMON_TCP` here — the TCP code is in `12e816e`; these are a separate
  layer of local work-in-progress.
- **`bridge/package.json` hard-codes the local checkout:**
  `@earendil-works/pi-agent-core: file:../../prime-agent-ref/node_modules/@earendil-works/pi-agent-core`
  and
  `@earendil-works/pi-coding-agent: file:../../prime-agent-ref/packages/coding-agent`.
  Those paths do not exist on a hosted runner.
- **Registry mismatch:** `@earendil-works/*` is published on npm at `0.84.2`
  (upstream latest), but the local source is `0.7.0` plus the unpublished TCP
  commit. Pointing `bridge/package.json` at the registry version installs the
  wrong (non-TCP-capable) code.

## Operator steps to make a hosted runner build the installer

1. Push `prime-agent-ref` to a reachable fork — including `12e816e` and the 14
   uncommitted files — and pin that SHA.
2. Publish (or npm-pin) the TCP-capable `@earendil-works/*@0.7.0` packages, and
   switch `bridge/package.json` off the `file:../../prime-agent-ref/...` paths
   to that pinned version.
3. In the tag CI job: download the pinned portable Node
   (`node-v24.18.0-win-x64`), `npm install` the bridge + daemon deps into
   `resources/node_modules`, then run `node scripts/bundle.mjs` before
   `npm run tauri build`.

Until those three land, the installer step will keep skipping on hosted
runners, which is correct. Do **not** commit `node.exe`/`node_modules`, and do
**not** switch the bridge to the registry `0.84.2` to force the build — that
silently drops TCP support and changes daemon behavior.
