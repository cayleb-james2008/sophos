#!/usr/bin/env node
/**
 * Reproducible Sophos runtime bundler.
 *
 * Inputs are locked by scripts/runtime-pins.json: Prime Agent v0.7.0 at an
 * immutable public Git commit, and the official Node for Windows executable
 * validated against the SHA-256 published in the Node distribution manifest.
 * The build uses the checked-in generated model catalog; it does not call
 * provider/model-catalog APIs or require credentials.
 */
import { cp, copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ensureNodeRuntime } from "./node-runtime.mjs";
import { ensurePrimeAgentRef, resolvePrimeAgentRef } from "./prime-agent-ref.mjs";
import {
  preparePrimeAgentSecurityBuildTree,
  resolvePrimeAgentSecurityWorkPaths,
  verifyPrimeAgentSecurityBuildTree,
} from "./prepare-prime-agent-security-build.mjs";
import { NODE_RUNTIME_PIN, PRIME_AGENT_PIN } from "./runtime-pins.mjs";
import { validateDaemonRuntimePackage } from "./daemon-runtime-package.mjs";
import { assertWindowsReleaseProvenance, createNativeBuildProvenance } from "./native-runtime-platform.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const WORKTREE = resolve(SCRIPT_DIR, "..");
const RESOURCES = join(WORKTREE, "resources");
const MANIFEST_PATH = join(RESOURCES, ".bundle-manifest.json");
const BRIDGE_DIR = join(WORKTREE, "bridge");
const COLORS = { green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", cyan: "\x1b[36m", gray: "\x1b[90m", reset: "\x1b[0m" };
const log = (color, ...values) => console.log(COLORS[color] ?? "", ...values, COLORS.reset);

function run(command, args, { label = command, ...options } = {}) {
  log("cyan", "▶", `${label}: ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: WORKTREE,
    stdio: "inherit",
    shell: process.platform === "win32",
    windowsHide: true,
    ...options,
  });
  if (result.error) throw new Error(`${label} could not start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${label} failed (exit ${result.status})`);
  return result;
}

async function countFiles(path) {
  let count = 0;
  const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isFile()) count += 1;
    else if (entry.isDirectory()) count += await countFiles(child);
  }
  return count;
}

async function sizeOf(path) {
  let bytes = 0;
  const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isFile()) bytes += (await stat(child)).size;
    else if (entry.isDirectory()) bytes += await sizeOf(child);
  }
  return bytes;
}

function requirePath(path, label) {
  if (!existsSync(path)) throw new Error(`${label} is missing: ${path}`);
}

function runNpm(args, options = {}) {
  return run("npm", args, options);
}

async function buildPinnedDaemon(primeAgentRoot, primeSourceRoot) {
  runNpm(["ci"], { cwd: primeAgentRoot, label: "Prime Agent locked dependency install (normal lifecycle)" });
  await verifyPrimeAgentSecurityBuildTree(WORKTREE, primeAgentRoot, primeSourceRoot);
  run(process.execPath, [
    join(primeAgentRoot, "node_modules", "vitest", "vitest.mjs"),
    "--run",
    "test/session-lease.test.ts",
    "test/tools-manager.test.ts",
  ], {
    cwd: join(primeAgentRoot, "packages", "coding-agent"),
    shell: false,
    label: "Prime Agent session-lease and Windows ZIP guard regression tests",
  });
  runNpm(["run", "build"], { cwd: join(primeAgentRoot, "packages", "tui"), label: "Prime Agent TUI build" });
  // pi-ai's normal build refreshes its model catalog from external vendor APIs.
  // Sophos uses the catalog committed at the pinned source revision instead.
  runNpm(["exec", "--prefix", ".", "--", "tsgo", "-p", "packages/ai/tsconfig.build.json"], {
    cwd: primeAgentRoot,
    label: "Prime Agent AI build (pinned checked-in catalog)",
  });
  runNpm(["run", "build"], { cwd: join(primeAgentRoot, "packages", "agent"), label: "Prime Agent agent-core build" });
  runNpm(["run", "build"], { cwd: join(primeAgentRoot, "packages", "coding-agent"), label: "Prime Agent daemon build" });

  const daemonDist = join(primeAgentRoot, "packages", "coding-agent", "dist");
  requirePath(join(daemonDist, "cli.js"), "built Prime Agent daemon CLI");
  requirePath(join(daemonDist, "bundle", "cli.js"), "built Prime Agent bundled CLI");
  return daemonDist;
}

async function stageUpstreamPackages(primeAgentRoot, targetNodeModules) {
  const packageRoot = join(primeAgentRoot, "packages");
  const scopeRoot = join(targetNodeModules, "@earendil-works");
  await rm(scopeRoot, { recursive: true, force: true });
  await mkdir(scopeRoot, { recursive: true });
  const packages = [
    { source: "agent", name: "pi-agent-core" },
    { source: "ai", name: "pi-ai" },
    { source: "coding-agent", name: "pi-coding-agent" },
    { source: "tui", name: "pi-tui" },
  ];
  for (const item of packages) {
    const source = join(packageRoot, item.source);
    const destination = join(scopeRoot, item.name);
    const packageJson = join(source, "package.json");
    const dist = join(source, "dist");
    const metadata = JSON.parse(await readFile(packageJson, "utf8"));
    if (metadata.version !== PRIME_AGENT_PIN.version) {
      throw new Error(`@earendil-works/${item.name} version ${metadata.version} does not match pinned ${PRIME_AGENT_PIN.version}`);
    }
    requirePath(dist, `built upstream package @earendil-works/${item.name}`);
    await mkdir(destination, { recursive: true });
    await copyFile(packageJson, join(destination, "package.json"));
    await cp(dist, join(destination, "dist"), { recursive: true, dereference: true });
  }
  return packages.map(({ name }) => `@earendil-works/${name}`);
}

function printHelp() {
  console.log(`Usage: node scripts/bundle.mjs [options]

Builds the frontend, pinned Prime Agent daemon, TypeScript bridge and Windows
Node runtime, then stages the self-contained Tauri resource layout.

Default mode is Windows-release staging and requires a real Windows x64 host.
Use --diagnostic on other hosts to build source diagnostics only; those resources
are marked ineligible for a Windows installer.

Options:
  --no-frontend       reuse an existing frontend dist/
  --no-bridge         reuse an existing bridge/dist/
  --no-node-modules   skip dependency staging (layout validation will fail)
  --layout-check-only assemble and validate, without creating an installer
  --diagnostic        permit host-native source diagnostics; never releaseable
  --help              show this help

Environment:
  PRIME_AGENT_REF     optional path to an unmodified clone of the exact pinned
                      public Prime Agent commit; default is .deps/prime-agent
                      on POSIX, or a unique directory under system TEMP on Windows
  PRIME_NODE_RUNTIME  optional node.exe (or directory containing it); accepted
                      only when its SHA-256 matches the official pinned binary
`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) return printHelp();
  const supportedFlags = new Set(["--no-frontend", "--no-bridge", "--no-node-modules", "--layout-check-only", "--diagnostic"]);
  const unknownFlags = args.filter((arg) => arg.startsWith("--") && !supportedFlags.has(arg));
  if (unknownFlags.length) throw new Error(`unsupported option(s): ${unknownFlags.join(", ")}`);
  const flags = new Set(args);
  const platformProvenance = createNativeBuildProvenance(flags.has("--diagnostic") ? "source-diagnostic" : "windows-release");
  if (!flags.has("--diagnostic")) {
    assertWindowsReleaseProvenance({ platformProvenance });
  }
  // Invalidate prior provenance before touching host-native dependencies. If
  // staging fails midway, no stale Windows manifest can bless the partial tree.
  await rm(MANIFEST_PATH, { force: true });
  const manifest = {
    generatedAt: new Date().toISOString(),
    platformProvenance,
    upstream: {},
    nodeRuntime: {},
    components: [],
    layout: {},
  };
  const record = (name, component) => manifest.components.push({ name, ...component });

  log("cyan", "\n=== Sophos pinned runtime bundle ===\n");

  if (!existsSync(join(WORKTREE, "node_modules"))) {
    runNpm(["ci"], { cwd: WORKTREE, label: "Sophos locked dependency install (normal lifecycle)" });
  }

  const privateTempRoot = process.platform === "win32"
    ? await mkdtemp(join(tmpdir(), "sophos-prime-agent-security-"))
    : undefined;
  const primePaths = resolvePrimeAgentSecurityWorkPaths(WORKTREE, {
    platform: process.platform,
    systemTempRoot: tmpdir(),
    privateTempRoot,
  });
  const primeSourceRoot = process.env.PRIME_AGENT_REF ?? primePaths.sourceRoot;
  const primeRefPath = resolvePrimeAgentRef(WORKTREE, primeSourceRoot);
  log("gray", "Prime Agent source:", relative(WORKTREE, primeRefPath) || primeRefPath);
  const primeSource = await ensurePrimeAgentRef(WORKTREE, primeSourceRoot);
  const primeBuild = await preparePrimeAgentSecurityBuildTree(WORKTREE, primeSource.path, primePaths.buildRoot);
  manifest.upstream = {
    repository: primeSource.repository,
    ref: primeSource.ref,
    commit: primeSource.commit,
    version: primeSource.version,
    license: primeSource.license,
    sourceDirectory: relative(WORKTREE, primeSource.path) || ".",
    buildDirectory: relative(WORKTREE, primeBuild.path) || ".",
    overlay: primeBuild.provenance,
  };

  const daemonDist = await buildPinnedDaemon(primeBuild.path, primeSource.path);

  const frontendDist = join(WORKTREE, "dist");
  if (!flags.has("--no-frontend")) {
    runNpm(["run", "build"], { cwd: WORKTREE, label: "Sophos frontend build" });
  } else {
    log("yellow", "reusing frontend dist/ (--no-frontend)");
  }
  requirePath(frontendDist, "frontend dist");
  record("frontend", {
    source: "dist/",
    files: await countFiles(frontendDist),
    bytes: await sizeOf(frontendDist),
    status: flags.has("--no-frontend") ? "reused" : "built",
  });

  const bridgeDist = join(BRIDGE_DIR, "dist");
  if (!flags.has("--no-bridge")) {
    runNpm(["ci"], { cwd: BRIDGE_DIR, label: "bridge locked dependency install (normal lifecycle)" });
    // The bridge's file dependencies intentionally point at the clean source
    // checkout. Compile against corresponding packages built from the overlay,
    // without modifying that immutable source checkout.
    await stageUpstreamPackages(primeBuild.path, join(BRIDGE_DIR, "node_modules"));
    runNpm(["run", "build"], { cwd: BRIDGE_DIR, label: "bridge TypeScript build" });
  } else {
    log("yellow", "reusing bridge/dist (--no-bridge)");
  }
  requirePath(join(bridgeDist, "bridge", "src", "index.js"), "built bridge entrypoint");

  const stagedDaemonDist = join(RESOURCES, "daemon", "dist");
  await rm(stagedDaemonDist, { recursive: true, force: true });
  await cp(daemonDist, stagedDaemonDist, { recursive: true, dereference: true });
  await mkdir(join(RESOURCES, "daemon"), { recursive: true });
  const daemonRuntimeManifest = JSON.parse(await readFile(join(RESOURCES, "daemon", "package.json"), "utf8"));
  validateDaemonRuntimePackage(daemonRuntimeManifest, PRIME_AGENT_PIN);
  await copyFile(join(primeSource.path, "LICENSE"), join(RESOURCES, "daemon", "LICENSE"));
  record("daemon", {
    source: `${manifest.upstream.buildDirectory}/packages/coding-agent/dist`,
    dest: "resources/daemon/dist",
    version: PRIME_AGENT_PIN.version,
    license: PRIME_AGENT_PIN.license,
    files: await countFiles(stagedDaemonDist),
    bytes: await sizeOf(stagedDaemonDist),
    status: "built from pinned source",
  });

  const stagedBridgeDist = join(RESOURCES, "bridge", "dist");
  await rm(stagedBridgeDist, { recursive: true, force: true });
  await cp(bridgeDist, stagedBridgeDist, { recursive: true, dereference: true });
  record("bridge", {
    source: "bridge/dist/",
    dest: "resources/bridge/dist",
    runtimeEntry: "bridge/dist/bridge/src/index.js",
    files: await countFiles(stagedBridgeDist),
    bytes: await sizeOf(stagedBridgeDist),
    status: flags.has("--no-bridge") ? "reused" : "built",
  });

  const nodeRuntime = await ensureNodeRuntime(WORKTREE);
  manifest.nodeRuntime = {
    version: nodeRuntime.version,
    platform: NODE_RUNTIME_PIN.platform,
    url: NODE_RUNTIME_PIN.url,
    sha256: nodeRuntime.sha256,
    source: process.env.PRIME_NODE_RUNTIME ? "verified operator-supplied binary" : "verified official Node distribution",
    dest: `resources/node/node-v${NODE_RUNTIME_PIN.version}-${NODE_RUNTIME_PIN.platform}/node.exe`,
  };
  record("node-runtime", { ...manifest.nodeRuntime, status: "sha256 verified" });

  const stagedNodeModules = join(RESOURCES, "node_modules");
  if (flags.has("--no-node-modules")) {
    log("yellow", "skipping node_modules staging (--no-node-modules)");
  } else {
    await rm(stagedNodeModules, { recursive: true, force: true });
    // Local workspace/file links do not bring their own dependencies into the
    // bridge install. Preserve the exact upstream lockfile's production graph
    // separately, then replace its workspace links with built package files.
    runNpm(["prune", "--omit=dev"], {
      cwd: primeBuild.path,
      label: "Prime Agent production dependency tree (normal lifecycle)",
    });
    await verifyPrimeAgentSecurityBuildTree(WORKTREE, primeBuild.path, primeSource.path);
    await cp(join(primeBuild.path, "node_modules"), stagedNodeModules, { recursive: true, dereference: false });
    await rm(join(stagedNodeModules, "@earendil-works"), { recursive: true, force: true });
    const upstreamPackages = await stageUpstreamPackages(primeBuild.path, stagedNodeModules);
    record("node_modules", {
      source: "pinned Prime Agent production lockfile plus bridge runtime packages",
      dest: "resources/node_modules/",
      builtOn: { ...platformProvenance.buildHost },
      target: { ...platformProvenance.target },
      mode: platformProvenance.mode,
      releaseEligible: platformProvenance.releaseEligible,
      upstreamPackages,
      files: await countFiles(stagedNodeModules),
      bytes: await sizeOf(stagedNodeModules),
      status: "staged from pinned production dependencies",
    });
  }

  manifest.layout = {
    node_exe: existsSync(nodeRuntime.path),
    daemon_cli: existsSync(join(stagedDaemonDist, "cli.js")),
    daemon_bundle_cli: existsSync(join(stagedDaemonDist, "bundle", "cli.js")),
    bridge_index: existsSync(join(stagedBridgeDist, "bridge", "src", "index.js")),
    node_modules_dir: existsSync(stagedNodeModules),
    daemon_license: existsSync(join(RESOURCES, "daemon", "LICENSE")),
  };
  const layoutOk = manifest.layout.node_exe
    && manifest.layout.daemon_cli
    && manifest.layout.daemon_bundle_cli
    && manifest.layout.bridge_index
    && manifest.layout.node_modules_dir
    && manifest.layout.daemon_license;
  log(layoutOk ? "green" : "red", layoutOk ? "✓ runtime layout and license present" : "✗ runtime layout incomplete");
  console.log(JSON.stringify(manifest.layout, null, 2));
  if (!layoutOk) throw new Error("bundle layout is incomplete; refusing to report success");

  await mkdir(RESOURCES, { recursive: true });
  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  log("cyan", "manifest:", MANIFEST_PATH);
  log("green", "\n=== bundle complete ===\n");
}

main().catch((error) => {
  log("red", "\n✗ bundle failed:", error.message);
  process.exitCode = 1;
});
