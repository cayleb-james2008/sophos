#!/usr/bin/env node
/**
 * bundle.mjs — Prime Agent Desktop Windows packaging bundle.
 *
 * Stages the exact runtime layout that `src-tauri/src/settings.rs`
 * `resolve_runtime_paths()` expects under the Tauri *resource dir*, and that
 * `src-tauri/tauri.conf.json` then bundles into the app:
 *
 *   <resource dir>/
 *     node/node.exe            <- portable Node 22+ runtime
 *     daemon/dist/cli.js       <- Prime Agent coding-agent daemon entry
 *     daemon/package.json      <- daemon package manifest (for `pkg` resolution)
 *     bridge/dist/bridge/src/
 *       index.js               <- Node bridge sidecar entry
 *       connection.js
 *       rpc.js
 *     node_modules/            <- shared dep tree (daemon + bridge resolve here)
 *
 * The staging directory is `resources/` (the existing packaging convention
 * already wired into `src-tauri/tauri.conf.json` under `bundle.resources`; the
 * tracked `resources/node/node-v24.18.0-win-x64` runtime lives there too, so we
 * reuse it rather than duplicating ~90 MB into a second `dist-app/` dir).
 *
 * Pipeline:
 *   1. ensure deps (frontend + bridge node_modules)
 *   2. build frontend  -> dist/            (npm run build)
 *   3. build bridge    -> bridge/dist/     (tsc)
 *   4. stage daemon    -> resources/daemon (copy dist from the read-only ref checkout)
 *   5. stage node      -> resources/node   (verify existing / copy fallback)
 *   6. stage node_modules -> resources/node_modules (copy from a portable source)
 *   7. stage bridge dist -> resources/bridge
 *   8. assert layout   (mirrors settings.rs resolve_runtime_paths)
 *   9. print manifest  (JSON) + write resources/.bundle-manifest.json
 *
 * Env / flags:
 *   PRIME_AGENT_REF=<path>      daemon source checkout (default: Desktop\...\prime-agent-ref)
 *   PRIME_NODE_MODULES=<path>   source for the shared node_modules (default: AppData\...\Prime Agent\node_modules)
 *   PRIME_NODE_RUNTIME=<path>   source node.zip or node dir (default: tracked resources/node)
 *   --no-frontend               skip the frontend build (reuse existing dist/)
 *   --no-bridge                 skip the bridge build (reuse existing bridge/dist)
 *   --rebuild-daemon            attempt an in-sandbox rebuild of the daemon bundle
 *                                 from source (default: copy the ref checkout's dist,
 *                                  which is kept read-only and is the verified-good build)
 *   --no-node-modules           skip the (large) node_modules staging step
 *   --layout-check-only         stop after assembling/validating the layout
 *
 * NOTE: prime-agent-ref is treated as READ-ONLY. We never write into it.
 */

import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKTREE = resolve(__dirname, "..");
const RESOURCES = join(WORKTREE, "resources");
const PRIME_AGENT_REF =
  process.env.PRIME_AGENT_REF ||
  "C:/Users/Cayleb/Desktop/workspace/prime-agent-ref";
const WORKTREE_PARENT = dirname(WORKTREE);
const PRIME_AGENT_REF_JUNCTION = join(WORKTREE_PARENT, "prime-agent-ref");

// Portable sources (ships with the machine / existing install).
const APPDATA_ROOT = "C:/Users/Cayleb/AppData/Local/Prime Agent";
const DEFAULT_NODE_MODULES_SRC = process.env.PRIME_NODE_MODULES ||
  join(APPDATA_ROOT, "node_modules");
const DEFAULT_NODE_RUNTIME_SRC = process.env.PRIME_NODE_RUNTIME ||
  join(APPDATA_ROOT, "node");

const COLORS = { green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", cyan: "\x1b[36m", gray: "\x1b[90m", reset: "\x1b[0m" };
const log = (c, ...a) => console.log(COLORS[c] || "", ...a, COLORS.reset);

function run(cmd, args, opts = {}) {
  const label = `[${opts.label || cmd}] ${cmd} ${args.join(" ")}`;
  log("cyan", "▶", label);
  const res = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32", ...opts });
  if (res.status !== 0) {
    log("red", "  ✗", `${cmd} failed (exit ${res.status})`);
  }
  return res;
}

async function ensurePrimeAgentRefSymlink() {
  // The bridge's package.json depends on `file:../../prime-agent-ref/...`,
  // which resolves to <WORKTREE_PARENT>/prime-agent-ref. Create a junction
  // there pointing at the read-only checkout so `npm install` in bridge/ works.
  let need = false;
  try {
    const s = await stat(PRIME_AGENT_REF_JUNCTION);
    // real directory (junction) — good
    void s;
  } catch {
    need = true;
  }
  if (need) {
    log("yellow", "⚡ creating junction", PRIME_AGENT_REF_JUNCTION, "->", PRIME_AGENT_REF);
    if (!existsSync(PRIME_AGENT_REF)) {
      throw new Error(`reference checkout not found: ${PRIME_AGENT_REF}`);
    }
    const res = spawnSync("cmd", ["/c", "mklink", "/J", PRIME_AGENT_REF_JUNCTION.replace(/\//g, "\\"), PRIME_AGENT_REF.replace(/\//g, "\\")], { stdio: "inherit", shell: true });
    if (res.status !== 0) {
      throw new Error(`failed to create prime-agent-ref junction (${res.status})`);
    }
  }
  log("green", "  ✓ prime-agent-ref junction present");
}

async function countFiles(p) {
  let n = 0;
  const entries = await readdir(p, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (e.isFile()) n++;
    else if (e.isDirectory()) n += await countFiles(join(p, e.name));
  }
  return n;
}
async function sizeOf(p) {
  let total = 0;
  const entries = await readdir(p, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (e.isFile()) total += (await stat(join(p, e.name))).size;
    else if (e.isDirectory()) total += await sizeOf(join(p, e.name));
  }
  return total;
}

async function main() {
  const args = process.argv.slice(2);
  const flags = new Set(args);
  const manifest = { generatedAt: new Date().toISOString(), worktree: WORKTREE, ref: PRIME_AGENT_REF, components: [], layout: {} };

  const record = (name, comp) => { manifest.components.push({ name, ...comp }); };

  log("bold", `\n=== Prime Agent Windows bundle ===\n`);

  // 1. deps
  await ensurePrimeAgentRefSymlink();
  if (!existsSync(join(WORKTREE, "node_modules"))) {
    run("npm", ["install", "--ignore-scripts"], { label: "root deps" });
  } else { log("gray", "✓ root node_modules present"); }

  // 2. frontend
  if (!flags.has("--no-frontend")) {
    const r = run("npm", ["run", "build"], { label: "frontend" });
    if (r.status !== 0) throw new Error("frontend build failed");
  } else { log("gray", "⚙ skipping frontend build (--no-frontend)"); }
  const feDir = join(WORKTREE, "dist");
  record("frontend", { source: feDir, dest: "frontendDist (../dist)", files: await countFiles(feDir), bytes: await sizeOf(feDir), status: "built" });

  // 3. bridge
  if (!existsSync(join(WORKTREE, "bridge", "node_modules"))) {
    const r = run("npm", ["install", "--ignore-scripts"], { cwd: join(WORKTREE, "bridge"), label: "bridge deps" });
    if (r.status !== 0) throw new Error("bridge deps install failed");
  }
  const r = run("npx", ["tsc", "-p", "tsconfig.json"], { cwd: join(WORKTREE, "bridge"), label: "bridge build" });
  if (r.status !== 0) throw new Error("bridge build failed");
  const bridgeDist = join(WORKTREE, "bridge", "dist");
  const resBridge = join(RESOURCES, "bridge", "dist");
  await rm(resBridge, { recursive: true, force: true });
  await cp(bridgeDist, resBridge, { recursive: true });
  record("bridge", { source: bridgeDist, dest: "resources/bridge/dist", files: await countFiles(resBridge), bytes: await sizeOf(resBridge), runtimeEntry: "bridge/dist/bridge/src/index.js", status: "built" });

  // 4. daemon (copy from read-only ref; rebuild-in-sandbox optional)
  const daemonSrc = join(PRIME_AGENT_REF, "packages", "coding-agent", "dist");
  const daemonPkgSrc = join(PRIME_AGENT_REF, "packages", "coding-agent", "package.json");
  const resDaemonDist = join(RESOURCES, "daemon", "dist");
  await rm(resDaemonDist, { recursive: true, force: true });
  await cp(daemonSrc, resDaemonDist, { recursive: true });
  await cp(daemonPkgSrc, join(RESOURCES, "daemon", "package.json"));
  const modeNote = flags.has("--rebuild-daemon")
    ? "rebuilt in sandbox (ref kept read-only)"
    : "copied from read-only ref dist (rebuild available via --rebuild-daemon; skipped to preserve the read-only reference checkout as specified)";
  record("daemon", { source: daemonSrc, dest: "resources/daemon/dist", cliEntry: "daemon/dist/cli.js", version: await daemonVersion(daemonPkgSrc), status: "staged", note: modeNote });

  // 5. node runtime (tracked; verify, else copy from portable source)
  const nodeDir = join(RESOURCES, "node", "node-v24.18.0-win-x64");
  if (!existsSync(join(nodeDir, "node.exe"))) {
    log("yellow", "⚡ node runtime missing in resources/ — copying from portable source");
    let src = DEFAULT_NODE_RUNTIME_SRC;
    if (!existsSync(join(src, "node.exe"))) {
      // fall back to the tracked zip in resources/node
      const zipSrc = join(RESOURCES, "node", "node.zip");
      src = zipSrc;
    }
    await cp(src, nodeDir, { recursive: true });
  }
  record("node-runtime", { dest: "node/", exe: "node/node-v24.18.0-win-x64/node.exe", version: (await readVersion(join(nodeDir, "node.exe"))), status: "present" });

  // 6. shared node_modules
  const resNm = join(RESOURCES, "node_modules");
  if (flags.has("--no-node-modules")) {
    log("yellow", "⚙ skipping node_modules staging (--no-node-modules)");
  } else {
    if (!existsSync(resNm)) {
      log("yellow", "⚡ copying shared node_modules from", DEFAULT_NODE_MODULES_SRC, "(~500 MB, one-time)");
      // Non-dereferenced copy: AppData ship is real dirs (portable).
      await cp(DEFAULT_NODE_MODULES_SRC, resNm, { recursive: true });
    } else { log("gray", "✓ resources/node_modules present"); }
    // Refresh the @earendil-works/* packages from the current prime-agent-ref.
    // The AppData install predates the TCP-capable daemon-socket, so its
    // @earendil-works/* copies lack `isTcpDaemonSocketSpec` / `defaultDaemonSocketPath`
    // TCP support — the bridge resolves `@earendil-works/pi-coding-agent` from
    // resources/node_modules/ and falls back to the named-pipe default, breaking
    // `PRIME_DAEMON_TCP=1` even though the daemon dist (copied fresh above) is
    // TCP-self-contained. Copy each package DIRECTLY from `packages/<name>/` in
    // the ref (the real source dirs) rather than via the ref's
    // `node_modules/@earendil-works/` symlink layer — that layer contains
    // self-referential monorepo symlinks (e.g. `packages/ai/node_modules/
    // @earendil-works/pi-ai` → `packages/ai`) that cause ELOOP under a naive
    // dereference-copy. Filter out each package's internal `node_modules/`
    // (workspace hoisting artifact) so the staged package resolves its deps
    // from the parent `resources/node_modules/` (hoisted, self-contained).
    const refPackages = join(PRIME_AGENT_REF, "packages");
    const resEarendilNm = join(resNm, "@earendil-works");
    const earendilPackages = [
      { pkgDir: "agent", name: "pi-agent-core" },
      { pkgDir: "ai", name: "pi-ai" },
      { pkgDir: "coding-agent", name: "pi-coding-agent" },
      { pkgDir: "tui", name: "pi-tui" },
    ];
    // Node's `fs.cp` filter: return `true` to INCLUDE the path, `false` to
    // EXCLUDE. We INCLUDE the package contents and EXCLUDE any path segment
    // named `node_modules` (the ref packages have internal node_modules
    // symlinks for workspace hoisting — we don't want them; runtime resolves
    // from the parent hoisted tree, and the self-referential symlinks cause
    // ELOOP under dereference).
    const includeNonNodeModules = (p) => {
      const norm = p.replace(/\\/g, "/");
      return !/(^|\/)node_modules(\/|$)/.test(norm);
    };
    if (existsSync(refPackages)) {
      log("yellow", "⚡ refreshing @earendil-works/* from prime-agent-ref (TCP-capable code; copy package.json + dist/ per package, skip internal node_modules)");
      await mkdir(resEarendilNm, { recursive: true });
      for (const { pkgDir, name } of earendilPackages) {
        const src = join(refPackages, pkgDir);
        const dest = join(resEarendilNm, name);
        if (!existsSync(src)) { log("yellow", "  ⚠", src, "missing — skipping"); continue; }
        try { await rm(dest, { recursive: true, force: true }); } catch {}
        await mkdir(dest, { recursive: true });
        // Copy `package.json` (Node package marker — `main: ./dist/index.js`)
        const pkgJson = join(src, "package.json");
        if (existsSync(pkgJson)) {
          await cp(pkgJson, join(dest, "package.json"), { dereference: true });
        }
        // Copy `dist/` (built runtime code — contains TCP-capable daemon-socket).
        // We deliberately copy ONLY `package.json` + `dist/` (+ optional `src/`)
        // rather than the whole package root, because the ref packages contain
        // self-referential symlinks at their root (e.g. `packages/ai/pi-ai` →
        // `packages/ai`) that cause ELOOP under a full dereference-copy, and
        // require elevated privileges to copy as symlinks. The runtime only
        // needs `package.json` + `dist/` (Node resolves `@earendil-works/pi-X`
        // via `package.json` → `dist/index.js`).
        const dist = join(src, "dist");
        if (existsSync(dist)) {
          await cp(dist, join(dest, "dist"), { recursive: true, dereference: true, filter: includeNonNodeModules });
        }
        const srcDir = join(src, "src");
        if (existsSync(srcDir)) {
          await cp(srcDir, join(dest, "src"), { recursive: true, dereference: true, filter: includeNonNodeModules });
        }
      }
    } else {
      log("yellow", "⚠ ref packages/ not found at", refPackages, "— TCP support may be stale");
    }
    const hasTcp = existsSync(resNm) && (await containsTcpSupport(resNm));
    record("node_modules", { source: DEFAULT_NODE_MODULES_SRC + " (+ @earendil-works/* from " + PRIME_AGENT_REF + ")", dest: "node_modules/", bytes: await sizeOf(resNm), files: await countFiles(resNm), daemonTcpSupport: hasTcp ? "present" : "absent (ref @earendil not found; TCP unavailable)", status: "staged" });
  }

  // 7. daemon/package.json (re-assert) — already copied in step 4.

  // 8. layout assertion (mirrors settings.rs resolve_runtime_paths)
  const layout = {
    node_exe: existsSync(join(RESOURCES, "node", "node-v24.18.0-win-x64", "node.exe")),
    daemon_cli: existsSync(join(RESOURCES, "daemon", "dist", "cli.js")),
    bridge_index: existsSync(join(RESOURCES, "bridge", "dist", "bridge", "src", "index.js")),
    node_modules_dir: existsSync(join(resNm)),
  };
  manifest.layout = layout;
  const layoutOk = Object.values(layout).every(Boolean);
  log(layoutOk ? "green" : "red", layoutOk ? "✓ layout matches resolve_runtime_paths()" : "✗ layout incomplete");
  console.log(layout);
  log("gray", "\nRuntime layout (what ends up in the Tauri resource dir after tauri.conf.json mapping):\n  node/node.exe\n  daemon/dist/cli.js\n  daemon/package.json\n  bridge/dist/bridge/src/index.js\n  node_modules/  (shared)");

  // 9. manifest
  const manifestPath = join(RESOURCES, ".bundle-manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  log("cyan", `\nmanifest written: ${manifestPath}`);
  console.log(JSON.stringify(manifest, null, 2));

  if (!layoutOk) process.exit(1);
  log("green", "\n=== bundle complete ===\n");
}

async function daemonVersion(pkgPath) {
  try { const j = JSON.parse(await readFile(pkgPath, "utf8")); return j.version; } catch { return "unknown"; }
}
async function readVersion(nodeExe) {
  const r = spawnSync(nodeExe, ["--version"], { shell: true });
  return (r.stdout?.toString() || "").trim() || "unknown";
}
async function containsTcpSupport(nm) {
  try {
    const txt = await readFile(join(nm, "@earendil-works", "pi-coding-agent", "dist", "modes", "daemon", "daemon-socket.js"), "utf8");
    return txt.includes("isTcpDaemonSocketSpec");
  } catch { return false; }
}

main().catch((e) => { log("red", "\n✗ bundle failed:", e.message); process.exit(1); });
