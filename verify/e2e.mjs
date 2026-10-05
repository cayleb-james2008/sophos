#!/usr/bin/env node
/**
 * Verify the staged Sophos runtime with the real pinned daemon and bridge.
 *
 * Linux/macOS use an isolated Unix-domain socket. Windows uses the daemon's
 * named-pipe transport. The harness always runs the packaged Node binary on
 * Windows; on non-Windows hosts it runs the actual host Node (a PE cannot be
 * executed natively there) and separately validates the bundled Windows
 * runtime checksum.
 */
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { selectE2ENode } from "./runtime-executable.mjs";
import { parseBridgeVerifyResult } from "./e2e-result.mjs";
import { validateNodeExecutable } from "../scripts/node-runtime.mjs";
import { NODE_RUNTIME_PIN, PRIME_AGENT_PIN } from "../scripts/runtime-pins.mjs";
import { PRIME_AGENT_SESSION_LEASE_OVERLAY } from "../scripts/apply-prime-agent-overlay.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RESOURCES = join(REPO, "resources");
const BUNDLED_NODE_EXE = join(RESOURCES, "node", `node-v${NODE_RUNTIME_PIN.version}-${NODE_RUNTIME_PIN.platform}`, "node.exe");
const NODE_EXE = selectE2ENode(process.platform, process.execPath, BUNDLED_NODE_EXE);
const DAEMON_CLI = join(RESOURCES, "daemon", "dist", "cli.js");
const BRIDGE_CLI = join(RESOURCES, "bridge", "dist", "bridge", "src", "index.js");
const BRIDGE_VERIFY = join(REPO, "bridge", "verify.mjs");
const BUNDLE_MANIFEST = join(RESOURCES, ".bundle-manifest.json");
const REPORT_PATH = join(REPO, "verify", "e2e-report.json");
const EVIDENCE_PATH = join(REPO, "verify", "e2e-evidence.txt");

const evidence = [];
const report = { startedAt: new Date().toISOString(), platform: process.platform, steps: [], summary: {} };
const push = (line) => { console.log(line); evidence.push(line); };
const record = (name, ok, detail = "") => {
  report.steps.push({ name, ok, detail });
  push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const exists = (path) => { try { return statSync(path).isFile() || statSync(path).isDirectory(); } catch { return false; } };

function runBridgeVerifier(env, timeoutMs = 180_000) {
  return new Promise((resolveResult) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const child = spawn(NODE_EXE, [BRIDGE_VERIFY], { cwd: REPO, env, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      resolveResult({ exitCode: null, signal: null, timedOut, stdout, stderr: `${stderr}${error.stack ?? error}\n` });
    });
    child.once("close", (exitCode, signal) => {
      clearTimeout(timer);
      resolveResult({ exitCode, signal, timedOut, stdout, stderr });
    });
  });
}

async function main() {
  mkdirSync(join(REPO, "verify"), { recursive: true });
  const testHome = mkdtempSync(join(tmpdir(), "sophos-e2e-home-"));
  const sessionCwd = join(testHome, "session-project");
  mkdirSync(sessionCwd, { recursive: true });
  try {
    push("\n=== Staged runtime layout and provenance ===\n");
    const layout = {
      selectedNode: exists(NODE_EXE),
      bundledWindowsNode: exists(BUNDLED_NODE_EXE),
      daemonCli: exists(DAEMON_CLI),
      bridgeEntry: exists(BRIDGE_CLI),
      bridgeVerifier: exists(BRIDGE_VERIFY),
      sharedNodeModules: exists(join(RESOURCES, "node_modules")),
      daemonLicense: exists(join(RESOURCES, "daemon", "LICENSE")),
      bundleManifest: exists(BUNDLE_MANIFEST),
    };
    report.layout = layout;
    for (const [name, ok] of Object.entries(layout)) record(`layout: ${name}`, ok);
    if (!Object.values(layout).every(Boolean)) {
      report.summary = { overall: "FAIL", reason: "staged runtime layout incomplete" };
      return;
    }

    let manifest;
    try {
      manifest = JSON.parse(readFileSync(BUNDLE_MANIFEST, "utf8"));
      record("provenance: pinned Prime Agent source", manifest.upstream?.commit === PRIME_AGENT_PIN.commit
        && manifest.upstream?.version === PRIME_AGENT_PIN.version
        && manifest.upstream?.license === PRIME_AGENT_PIN.license,
      `${manifest.upstream?.version} ${manifest.upstream?.commit} (${manifest.upstream?.license})`);
      const overlay = manifest.upstream?.overlay;
      const expectedOverlay = PRIME_AGENT_SESSION_LEASE_OVERLAY;
      const overlayMatches = overlay?.id === expectedOverlay.id
        && overlay?.upstreamRepository === expectedOverlay.upstreamRepository
        && overlay?.upstreamCommit === expectedOverlay.upstreamCommit
        && overlay?.sourcePath === expectedOverlay.sourcePath
        && overlay?.sourceSha256 === expectedOverlay.sourceSha256
        && overlay?.patchPath === expectedOverlay.patchPath
        && overlay?.patchSha256 === expectedOverlay.patchSha256
        && overlay?.patchedSourceSha256 === expectedOverlay.patchedSourceSha256;
      record("provenance: audited Windows session-lease overlay", overlayMatches,
        overlayMatches ? `${overlay.id} source=${overlay.sourceSha256} patch=${overlay.patchSha256}` : "bundle overlay metadata does not match the pinned source patch");
    } catch (error) {
      record("provenance: pinned Prime Agent source", false, String(error));
      report.summary = { overall: "FAIL", reason: "bundle manifest missing or invalid" };
      return;
    }

    try {
      const checked = await validateNodeExecutable(BUNDLED_NODE_EXE);
      record("provenance: official bundled Node SHA-256", checked.sha256 === NODE_RUNTIME_PIN.sha256,
        `${checked.version} ${checked.sha256}`);
    } catch (error) {
      record("provenance: official bundled Node SHA-256", false, String(error));
    }
    record("license: staged upstream MIT notice", manifest.upstream?.license === "MIT"
      && readFileSync(join(RESOURCES, "daemon", "LICENSE"), "utf8").includes("MIT License"));

    const runtimeRequire = createRequire(DAEMON_CLI);
    for (const packageName of ["pi-coding-agent", "pi-agent-core", "pi-ai", "pi-tui"]) {
      const entry = join(RESOURCES, "node_modules", "@earendil-works", packageName, "dist", "index.js");
      record(`runtime package staged: @earendil-works/${packageName}`, exists(entry), entry);
    }
    for (const dependency of ["proper-lockfile", "typebox", "zeromq"]) {
      try {
        record(`runtime dependency resolves: ${dependency}`, true, runtimeRequire.resolve(dependency));
      } catch (error) {
        record(`runtime dependency resolves: ${dependency}`, false, error.message);
      }
    }

    if (!report.steps.every((step) => step.ok)) {
      report.summary = { overall: "FAIL", reason: "runtime provenance or dependency validation failed" };
      return;
    }

    push("\n=== Real daemon + bridge JSON-RPC integration ===\n");
    const isolatedEnv = Object.fromEntries(
      ["PATH", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "SystemDrive", "LANG", "LC_ALL", "TZ"]
        .filter((name) => process.env[name] !== undefined)
        .map((name) => [name, process.env[name]]),
    );
    const env = {
      ...isolatedEnv,
      HOME: testHome,
      USERPROFILE: testHome,
      XDG_CONFIG_HOME: join(testHome, ".config"),
      XDG_DATA_HOME: join(testHome, ".local", "share"),
      XDG_CACHE_HOME: join(testHome, ".cache"),
      APPDATA: join(testHome, "AppData", "Roaming"),
      LOCALAPPDATA: join(testHome, "AppData", "Local"),
      TMPDIR: tmpdir(),
      TEMP: tmpdir(),
      TMP: tmpdir(),
      PI_OFFLINE: "1",
      REF: join(RESOURCES, "daemon"),
      BRIDGE: BRIDGE_CLI,
      BRIDGE_VERIFY_RECOVERY: "1",
      BRIDGE_VERIFY_SESSION_CWD: sessionCwd,
    };
    push("\n=== Pinned session-lease ownership, replacement, and provenance ===\n");
    const leaseTestHome = mkdtempSync(join(tmpdir(), "sophos-session-lease-e2e-home-"));
    const leaseTestEnv = {
      ...isolatedEnv,
      HOME: leaseTestHome,
      USERPROFILE: leaseTestHome,
      XDG_CONFIG_HOME: join(leaseTestHome, ".config"),
      XDG_DATA_HOME: join(leaseTestHome, ".local", "share"),
      XDG_CACHE_HOME: join(leaseTestHome, ".cache"),
      APPDATA: join(leaseTestHome, "AppData", "Roaming"),
      LOCALAPPDATA: join(leaseTestHome, "AppData", "Local"),
      TMPDIR: tmpdir(),
      TEMP: tmpdir(),
      TMP: tmpdir(),
      PI_OFFLINE: "1",
    };
    let leaseTests;
    try {
      leaseTests = spawnSync(NODE_EXE, ["--test", join(REPO, "scripts", "session-lease-lifecycle.test.mjs")], {
        cwd: REPO,
        env: leaseTestEnv,
        encoding: "utf8",
        windowsHide: true,
        timeout: 60_000,
        maxBuffer: 10 * 1024 * 1024,
      });
    } finally {
      rmSync(leaseTestHome, { recursive: true, force: true });
    }
    if (leaseTests.stdout?.trim()) push(leaseTests.stdout.trimEnd());
    if (leaseTests.stderr?.trim()) push(`[session-lease stderr]\n${leaseTests.stderr.trimEnd()}`);
    record("pinned session-lease holder, replacement, and provenance regressions",
      leaseTests.status === 0 && !leaseTests.error,
      `exit=${leaseTests.status ?? "not-started"}${leaseTests.error ? `; ${leaseTests.error.message}` : ""}`);
    const hostAuthFile = join(testHome, ".prime", "agent", "auth.json");
    record("session E2E starts from isolated HOME with no host auth file",
      !existsSync(hostAuthFile) && readdirSync(testHome).length === 1,
      `initial HOME entries=${JSON.stringify(readdirSync(testHome))}`);
    record("session E2E uses an allow-listed environment without provider credentials",
      Object.keys(env).every((name) => !/(API.?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(name)),
      `environment keys=${Object.keys(env).sort().join(",")}`);
    const verification = await runBridgeVerifier(env);
    push(verification.stdout.trimEnd());
    if (verification.stderr.trim()) push(`[bridge verifier stderr]\n${verification.stderr.trimEnd()}`);
    const result = parseBridgeVerifyResult(verification.exitCode, verification.stdout);
    report.bridgeVerification = {
      exitCode: verification.exitCode,
      signal: verification.signal,
      timedOut: verification.timedOut,
      passed: result.passed,
      total: result.total,
      stdout: verification.stdout,
      stderr: verification.stderr,
    };
    record("real staged daemon/bridge integration and reconnect", result.ok && !verification.timedOut,
      `${result.passed}/${result.total} checks; exit=${verification.exitCode}; transport=${process.platform === "win32" ? "Windows named pipe" : "Unix-domain socket"}`);
    report.summary = {
      overall: report.steps.every((step) => step.ok) ? "PASS" : "FAIL",
      testedPlatform: process.platform,
      localTransport: process.platform === "win32" ? "named pipe" : "Unix-domain socket",
      windowsNativeTested: process.platform === "win32",
      bundledNodeExecuted: process.platform === "win32",
      bridgeDaemonChecks: `${result.passed}/${result.total}`,
    };
  } finally {
    // Early returns still reach finally: no failed or incomplete report may exit zero.
    process.exitCode = report.summary.overall === "PASS" ? 0 : 1;
    rmSync(testHome, { recursive: true, force: true });
    report.finishedAt = new Date().toISOString();
    writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
    writeFileSync(EVIDENCE_PATH, `${evidence.join("\n")}\n`);
    push(`\nreport: ${REPORT_PATH}`);
    push(`evidence: ${EVIDENCE_PATH}`);
  }
}

main().catch((error) => {
  console.error("e2e harness crashed:", error);
  process.exitCode = 2;
});
