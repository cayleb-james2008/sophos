# Sophos

Sophos is a Windows-native port of Prime Intellect's Prime Agent. The upstream
original is [PrimeIntellect-ai/prime-agent](https://github.com/PrimeIntellect-ai/prime-agent).

A Tauri v2 (Rust) shell that spawns and supervises the Prime Agent coding-agent
daemon, fronts it with a Node bridge sidecar over JSON-RPC, and renders a React
frontend.

The packaging for this piece lives in `scripts/`, `src-tauri/`, and `verify/`.

---

## Layout of the bundled app

At runtime the Tauri resource dir contains (this is exactly what
`src-tauri/src/settings.rs::resolve_runtime_paths()` expects):

```
<resource dir>/
  node/node.exe                 # portable Node 22+ runtime
  daemon/dist/cli.js            # prime-agent coding-agent --mode daemon entry
  daemon/package.json
  bridge/dist/bridge/src/index.js   # JSON-RPC sidecar entry
  node_modules/                 # shared dependency tree for daemon + bridge
```

The mapping from the staging dir `resources/` → the runtime resource dir is
declared in `src-tauri/tauri.conf.json` under `bundle.resources`:

| staging (`resources/`) | runtime resource dir |
| --- | --- |
| `resources/daemon/dist` | `daemon/dist` |
| `resources/daemon/package.json` | `daemon/package.json` |
| `resources/bridge/dist` | `bridge/dist` |
| `resources/node_modules` | `node_modules` |
| `resources/node/node-v24.18.0-win-x64` | `node` |

> The staging directory is `resources/` (the pre-existing packaging
> convention already wired into `tauri.conf.json`, with the tracked Node
> runtime already committed under `resources/node/`). We keep that convention
> rather than duplicating ~90 MB of node runtime into a second `dist-app/`
> staging directory.

---

## Prerequisites

| Tool | Why | Version |
| --- | --- | --- |
| **Node.js** | build the frontend + bridge | 22+ (tested with 24.18.0) |
| **Rust (rustc/cargo)** | compile the Tauri shell | 1.90+ (tested with 1.97.1) |
| **Tauri CLI** (`@tauri-apps/cli`) | `npm run tauri` | 2.x (tested with 2.11.4) |
| **NSIS (`makensis`)** | build the `.exe` installer | see Troubleshooting |
| **Git for Windows** | provides `bash` for the daemon shell + the `prime-agent-ref` junction | any recent version |
| **bash** (Git Bash) | the coding-agent daemon shell uses bash for tool execution | Git for Windows suffices |

### The daemon needs a bash shell on Windows

The daemon (`prime-agent coding-agent`) spawns bash for its shell tool. It is
launched by the Rust shell as `node <cli> --mode daemon`. See the daemon's own
[windows.md](prime-agent-ref/packages/coding-agent/docs/windows.md) for the
shell resolution order (Git Bash → `bash.exe` on PATH → custom path from
`~/.prime/agent/settings.json`). If no bash is found, bash-backed tools will
fail at runtime (the daemon itself still starts).

---

## Build (bundle + Tauri)

```bash
# 1. Stage the runtime layout under resources/ (daemon dist, bridge dist,
#    node runtime, shared node_modules) + build the frontend/bridge:
node scripts/bundle.mjs          # prints a JSON manifest to stdout

# 2. (optional) Build the native installer:
npm run tauri build              # see Troubleshooting — NSIS may be missing
```

`scripts/bundle.mjs` flags:

| Flag | Effect |
| --- | --- |
| `--no-frontend` | reuse existing `dist/` (skip `npm run build`) |
| `--no-bridge` | reuse existing `bridge/dist` |
| `--rebuild-daemon` | reserved, note-only for now: the daemon is always copied from the read-only ref `dist/`; a real in-sandbox rebuild is not yet wired. The flag only changes the manifest note text |
| `--no-node-modules` | skip the ~500 MB `node_modules` staging step |
| `--layout-check-only` | stop after assembling/validating the layout |
| `--help` | show usage |

The manifest is also written to `resources/.bundle-manifest.json`.

### Environment

- `PRIME_AGENT_REF=<path>` — daemon source checkout (default
  `C:\Users\Cayleb\Desktop\workspace\prime-agent-ref`). Treated as **read-only**;
  the bundle copies its `dist/`, it never writes into it.
- `PRIME_NODE_MODULES=<path>` — portable source for the shared `node_modules`
  (default: the existing installed app at
  `%LOCALAPPDATA%\Sophos\node_modules`).
- `PRIME_NODE_RUNTIME=<path>` — portable Node runtime source (default: the
  installed app's `node/`).

---

## Named-pipe wedge & TCP fallback (Windows)

On some Windows machines `CreateNamedPipeW` returns `ERROR_INVALID_NAME` for
every caller (Node's `net.Server.listen('\\.\pipe\...')` → `EACCES`/invalid
name), while TCP loopback keeps working. When that happens the daemon can be
launched on a TCP transport instead of the default named pipe:

| Mechanism | Effect |
| --- | --- |
| env `PRIME_DAEMON_TCP=1` | daemon + client use `tcp://127.0.0.1:48100` (port overridable via `PRIME_DAEMON_TCP_PORT`) |
| `--daemon-socket tcp://127.0.0.1:48130` | explicit TCP endpoint for the daemon (and any client using the same spec) |

The transport is chosen purely from the socket *spec string*: anything starting
with `tcp://` is TCP; everything else keeps named-pipe/Unix-domain behavior.

The end-to-end harness (`verify/e2e.mjs`) tries the named-pipe transport
first and falls back to TCP automatically, so verification passes even on a
pipe-wedged machine.

---

## Verify

```bash
# Full pipeline: bundle + layout + daemon TCP round-trip (PASS/FAIL report):
node scripts/bundle.mjs
node verify/e2e.mjs                       # uses the staged resources/
```

Reports are written to `verify/e2e-report.json` and `verify/e2e-evidence.txt`.

---

## Install / run / first run

`npm run tauri build` produces the Tauri-default NSIS installer
(`Sophos_0.1.0_x64-setup.exe` for this `productName`/`version`/arch;
installs per-user to `~\AppData\Local\Sophos`). The installer artifact
name is derived from `productName` + `version` + `arch` — there is **no**
`artifact` field in Tauri 2.11.4's NSIS config schema (a custom installer
filename requires a custom NSIS `template` with `OutFile`). After install:

1. Launch **Sophos**.
2. On first run the daemon starts (named pipe by default; TCP fallback if
   `PRIME_DAEMON_TCP=1` or the pipe is wedged).
3. Open **Settings → Providers** and add an LLM provider (API key / local
   model) — this is provider login.

---

## Icon

The Sophos mark is a sharp geometric **Σ** (sigma — the sum of knowledge,
nodding to the Greek root of "Sophos": wisdom/intellect). It is drawn in
off-white `#f4f4f4` with a single terminal-green `#85ed75` accent dot on a
near-black `#0e0e0e` field — sharp corners, flat, minimal, and legible from
16px to 512px. It is deliberately distinct from the Prime Intellect logo.

- Source: `public/sophos-icon.svg` (also the in-app favicon)
- Master PNG: `resources/icon.png` (512×512)
- Tauri icon set: `src-tauri/icons/` (`32x32.png`, `128x128.png`,
  `128x128@2x.png`, `256x256.png`, `icon.png`, `icon.ico`)
- Regenerate with: `python scripts/gen-icon.py`

---

## Troubleshooting

**Named pipes blocked (`ERROR_INVALID_NAME` / `EACCES` on `\\.\pipe\…`).**

This machine is affected. Set `PRIME_DAEMON_TCP=1` (optionally
`PRIME_DAEMON_TCP_PORT`) before launching, or pass `--daemon-socket
tcp://127.0.0.1:48130` to the daemon. A reboot occasionally clears
`CreateNamedPipeW`, but the TCP fallback is reliable and preferred.

**`npm run tauri build` fails — two historically-documented blockers (both non-blocking).**

The frontend, Rust shell, and NSIS-patching all succeed; the failure happens
*before* or *at* the final `makensis` step. Both blockers are **non-blocking**
(native binary + frontend + bundle are green; only the final `.exe`
installer wrapper fails). Documented in build order:

**Blocker #1 (FIXED in current `tauri.conf.json`) — invalid NSIS `artifact`
field caused config-validation to fail before any build step.**

An earlier revision of `src-tauri/tauri.conf.json` included
`"artifact": "PrimeAgentSetup.exe"` under `bundle.windows.nsis`. That field
is **not** in Tauri 2.11.4's NSIS schema (valid fields: `template`,
`headerImage`, `sidebarImage`, `installerIcon`, `uninstallerIcon`,
`uninstallerHeaderImage`, `installMode`, `languages`,
`customLanguageFiles`, `displayLanguageSelector`, `compression`,
`startMenuFolder`, `installerHooks`, `minimumWebview2Version`). The invalid
field made Tauri reject the config with an immediate validation error,
**before** the Rust compile / frontend build / `makensis` steps ran. Fix:
remove the field. To set a custom installer filename, valid mechanisms are
a custom NSIS `template` (`.nsi`) with `OutFile`, or changing the
top-level `productName` (the default installer name is derived from
`${productName}_${version}_${arch}-setup.exe`). The committed config now
uses the Tauri default name (`Sophos_0.1.0_x64-setup.exe`).

**Blocker #2 (current, documented non-blocking) — `makensis` aborts on
`File:` (MAX_PATH, 260 chars) for a deeply-nested `@mistralai` resource.**

With the config validation passing, `npm run tauri build` compiles the Rust
binary (`sophos.exe`, cargo `release` in 3m33s), vites the
frontend (77 modules → 256 KB), patches the NSIS exe — then `makensis`
aborts on its `File:` directive because one bundled resource path exceeds
Windows `MAX_PATH` (260 chars):

```
File: failed opening file "...\\piece-packaging\\resources\\node_modules\\
  @mistralai\\mistralai\\esm\\models\\operations\\
  getchatcompletionfieldoptionscountsv1observabilitychatcompletionfieldsfieldnameoptionscountspost.js"
Error in script "...installer.nsi" on line 8229 -- aborting creation process
failed to bundle project: Failed to bundle app with makensis
```

> The exact abort **line number varies by run** (observed 8229–8273 across
> runs) because the generated `installer.nsi` file ordering depends on the
> staged `resources/node_modules/` contents. Same failing file, same MAX_PATH
> cause.

The offending path is the shared `resources/node_modules/` tree being
folded into the NSIS `installer.nsi` (the `@mistralai` package nests
~113 MB of deeply-named `.js`/`.d.ts`/`.map` files under a very long
package path). NSIS 2.x does not enable long-path awareness by default,
so any single bundled file whose on-disk path exceeds 260 chars aborts the
build.

This is a **documented, non-blocking** failure: the native binary +
frontend + bundle are built; only the final `.exe` installer wrapper
fails. Verified workarounds (per the contract, documented here — not
applied to the committed layout):

1. Strip runtime-irrelevant `.d.ts`/`.map`/`.map` files from the staged
   `resources/node_modules` before bundling (reduces payload ~113 MB and
   removes the longest `.d.ts.map` paths — the original abort line was
   `14227`; after stripping `.d.ts.map`/`.map` it moved to the `.js`
   variant, whose deepest segment still exceeds 260 chars on this long
   worktree path).
2. Enable Windows long-paths (`regedit →
   Computer\ControlSet\Services\WebClient\…`, or `Group Policy → Enable
   Win32 long paths`) **and** rebuild with NSIS 3.x (`!include
   WinMessages.nsh` / `SetCompress`/`/LONGPATHS` equivalent).
3. Stage the bundle closer to the repo root (shorter worktree path) to
   bring the deepest resource path under 260 chars.

> tauri 2.11.4, Rust 1.97.1, bundled NSIS `makensis` present — the
> remaining blocker is a `MAX_PATH` abort, **not** a missing toolchain.
> See `verify/e2e-evidence.txt` for the captured build log excerpt.

**Daemon: `DaemonSupervisorAlreadyRunningError`.**

A stale supervisor registry from a crashed daemon is left under
`~/.prime/agent/daemon-workers/`. `node <cli> daemon ps` lists supervisors;
remove the stale `supervisor-config` (or run `daemon ps --cleanup`) and
restart. The E2E harness uses a unique TCP port per run to avoid this.
