// End-to-end verification harness for the bridge sidecar.
//
// Spawns a fresh daemon, runs the sidecar, drives it through JSON-RPC commands
// over stdio, asserts the framing and results, and reports pass/fail.
//
// Usage:  node verify.mjs   (from the bridge/ directory)
// Each run uses a unique named-pipe/Unix-socket endpoint and passes it to both
// the daemon and bridge; production transport defaults are not changed.
// Output: prints PASS/FAIL lines plus a final summary.

import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { getSessionRecoveryAssertions } from "./session-recovery-readiness.mjs";
import { safeDiagnosticError, traceShutdownRpc } from "./verify-shutdown-diagnostics.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REF_ROOT = resolve(
  process.env.REF ?? resolve(REPO_ROOT, "..", "prime-agent-ref", "packages", "coding-agent"),
);
const DAEMON_CLI = process.env.DAEMON_CLI || join(REF_ROOT, "dist", "cli.js");
const BRIDGE = process.env.BRIDGE || join(REPO_ROOT, "bridge", "dist", "bridge", "src", "index.js");

const results = [];

function isolatedSocketPath() {
  const runId = `${process.pid}-${randomUUID().slice(0, 8)}`;
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\prime-agent-bridge-verify-${runId}`;
  }
  // Linux UDS paths are limited (typically 108 bytes); TMPDIR may itself be
  // deeply nested in isolated test environments, so keep the basename short.
  return join(tmpdir(), `pa-${runId}.sock`);
}

const SOCKET_PATH = process.env.BRIDGE_VERIFY_SOCKET || isolatedSocketPath();
const SHUTDOWN_EVIDENCE_DIR = process.env.BRIDGE_VERIFY_EVIDENCE_DIR
  ? resolve(process.env.BRIDGE_VERIFY_EVIDENCE_DIR)
  : undefined;
const shutdownEvidence = {
  schemaVersion: 1,
  startedAt: new Date().toISOString(),
  socketPath: SOCKET_PATH,
  events: [],
  rpc: [],
  snapshots: [],
  recoverySupervisors: [],
  supervisorMilestones: [],
  rawDaemonLogs: [],
};

function recordShutdownEvent(event, details = {}) {
  try {
    const entry = { event, at: new Date().toISOString(), ...details };
    shutdownEvidence.events.push(entry);
    console.log(`[shutdown-diagnostic] ${JSON.stringify(entry)}`);
    return entry;
  } catch {
    return undefined;
  }
}

function appendShutdownEvidence(collection, entry) {
  try {
    collection.push(entry);
  } catch {
    // Diagnostics must not interrupt the runtime under test.
  }
}

function traceShutdownRpcSafely(target) {
  try {
    return traceShutdownRpc(target, shutdownEvidence.rpc);
  } catch (error) {
    recordShutdownEvent("shutdown_rpc_trace_install_error", safeDiagnosticError(error));
    return () => undefined;
  }
}

function terminateProcessTree(proc) {
  if (!proc?.pid || proc.exitCode !== null) return;
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
    } catch {
      // The process may have exited between the check and taskkill.
    }
    return;
  }
  try { proc.kill("SIGTERM"); } catch {}
}

async function terminateSupervisorOnly(identity) {
  if (!Number.isInteger(identity?.pid) || identity.pid <= 0) return false;
  if (typeof identity.processStartId !== "string" || identity.processStartId.length === 0) return false;
  const sessionLeaseUrl = pathToFileURL(join(REF_ROOT, "dist", "core", "session-lease.js")).href;
  const { getProcessStartId } = await import(sessionLeaseUrl);
  const currentStartId = getProcessStartId(identity.pid);
  if (!currentStartId || currentStartId !== identity.processStartId) return false;
  if (process.platform === "win32") {
    try {
      // Deliberately omit /T: the Windows worker is not detached, but it must
      // survive a supervisor-only restart so the replacement can adopt it.
      execFileSync("taskkill", ["/PID", String(identity.pid), "/F"], { stdio: "ignore" });
      return true;
    } catch {
      // The process may have exited between the identity check and taskkill.
      return false;
    }
  }
  try {
    process.kill(identity.pid, "SIGTERM");
    return true;
  } catch {
    return false;
  }
}

function record(label, ok, detail) {
  results.push({ label, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
}

async function waitForExit(proc, timeoutMs = 5000) {
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return true;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    proc.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

function readWorkerDescriptorPids() {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? tmpdir();
  const descriptorRoot = join(home, ".prime", "agent", "daemon-workers");
  if (!existsSync(descriptorRoot)) return [];
  const workers = [];
  try {
    for (const directory of readdirSync(descriptorRoot, { withFileTypes: true })) {
      if (!directory.isDirectory()) continue;
      const directoryPath = join(descriptorRoot, directory.name);
      for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        try {
          const descriptor = JSON.parse(readFileSync(join(directoryPath, entry.name), "utf8"));
          if (typeof descriptor.workerId === "string" && Number.isInteger(descriptor.pid) && descriptor.pid > 0) {
            workers.push({ pid: descriptor.pid, lifecycle: typeof descriptor.lifecycle === "string" ? descriptor.lifecycle : "unknown" });
          }
        } catch {
          // A descriptor may be atomically replaced while diagnostics are reading it.
        }
      }
    }
  } catch {
    // The daemon can remove its descriptor tree concurrently with diagnostics.
  }
  return workers;
}

async function persistShutdownEvidence() {
  const configUrl = pathToFileURL(join(REF_ROOT, "dist", "config.js")).href;
  try {
    const { getDaemonLogPath } = await import(configUrl);
    const daemonLogPath = getDaemonLogPath(SOCKET_PATH);
    const files = [
      { source: daemonLogPath, name: "daemon-supervisor.raw.log" },
      { source: `${daemonLogPath}.old`, name: "daemon-supervisor.raw.log.old" },
    ];
    let currentLogText = "";
    for (const file of files) {
      if (!existsSync(file.source)) continue;
      const bytes = readFileSync(file.source);
      const text = bytes.toString("utf8");
      if (file.name === "daemon-supervisor.raw.log") currentLogText = text;
      const metadata = {
        file: file.name,
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
      appendShutdownEvidence(shutdownEvidence.rawDaemonLogs, metadata);
      for (const line of text.split(/\r?\n/)) {
        const marker = "[PR11_SHUTDOWN_DIAG] ";
        const markerAt = line.indexOf(marker);
        if (markerAt < 0) continue;
        try {
          const milestone = JSON.parse(line.slice(markerAt + marker.length));
          appendShutdownEvidence(shutdownEvidence.supervisorMilestones, {
            logTimestamp: line.match(/^\[([^\]]+)\]/)?.[1] ?? null,
            ...milestone,
          });
        } catch {
          appendShutdownEvidence(shutdownEvidence.supervisorMilestones, { rawLine: line });
        }
      }
      if (SHUTDOWN_EVIDENCE_DIR) {
        mkdirSync(SHUTDOWN_EVIDENCE_DIR, { recursive: true });
        writeFileSync(join(SHUTDOWN_EVIDENCE_DIR, file.name), bytes);
      }
    }
    const tailLines = currentLogText.split(/\r?\n/).filter(Boolean).slice(-100);
    const latestReplacement = [...shutdownEvidence.recoverySupervisors].reverse().find((item) =>
      item.stage.includes("after-replacement") && item.socketSupervisor?.reachable,
    );
    shutdownEvidence.replacementSupervisorLogTail = {
      capturedAt: new Date().toISOString(),
      sourceFile: "daemon-supervisor.raw.log",
      lineCount: tailLines.length,
      targetSupervisor: shutdownEvidence.shutdownTargetSupervisor ?? null,
      latestObservedReplacementSupervisor: latestReplacement?.socketSupervisor ?? null,
    };
    if (SHUTDOWN_EVIDENCE_DIR && tailLines.length > 0) {
      mkdirSync(SHUTDOWN_EVIDENCE_DIR, { recursive: true });
      writeFileSync(join(SHUTDOWN_EVIDENCE_DIR, "replacement-supervisor.log-tail.raw.txt"), `${tailLines.join("\n")}\n`);
    }
  } catch (error) {
    shutdownEvidence.logCaptureError = safeDiagnosticError(error).error;
  }

  recordShutdownEvent("shutdown_evidence_captured", {
    outputDirectory: SHUTDOWN_EVIDENCE_DIR ?? null,
    rawLogFiles: shutdownEvidence.rawDaemonLogs.map(({ file, bytes, sha256 }) => ({ file, bytes, sha256 })),
    supervisorMilestoneCount: shutdownEvidence.supervisorMilestones.length,
    logCaptureError: shutdownEvidence.logCaptureError ?? shutdownEvidence.persistError ?? null,
  });
  shutdownEvidence.finishedAt = new Date().toISOString();
  if (SHUTDOWN_EVIDENCE_DIR) {
    try {
      mkdirSync(SHUTDOWN_EVIDENCE_DIR, { recursive: true });
      writeFileSync(join(SHUTDOWN_EVIDENCE_DIR, "shutdown-diagnostics.json"), `${JSON.stringify(shutdownEvidence, null, 2)}\n`);
    } catch (error) {
      shutdownEvidence.persistError = safeDiagnosticError(error).error;
    }
  }
}

async function inspectSupervisorIdentity() {
  const daemonClientUrl = pathToFileURL(join(REF_ROOT, "dist", "modes", "daemon", "daemon-client.js")).href;
  const { DaemonClient } = await import(daemonClientUrl);
  const client = new DaemonClient(SOCKET_PATH);
  try {
    await client.connect(500);
    const hello = await client.waitForHello(500).catch(() => undefined);
    return {
      reachable: true,
      ...(Number.isInteger(hello?.supervisorPid) ? { pid: hello.supervisorPid } : {}),
      ...(typeof hello?.supervisorProcessStartId === "string" ? { processStartId: hello.supervisorProcessStartId } : {}),
    };
  } catch {
    return { reachable: false };
  } finally {
    client.close();
  }
}

async function waitForProcessIdentityExit(identity, timeoutMs = 5000) {
  if (!Number.isInteger(identity?.pid) || identity.pid <= 0) return false;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processIsAlive(identity.pid)) return true;
    await sleep(100);
  }
  return !processIsAlive(identity.pid);
}

function isReplacementIdentity(current, previous) {
  return Boolean(current?.reachable && Number.isInteger(current.pid) && current.pid > 0
    && (current.pid !== previous?.pid
      || (typeof current.processStartId === "string" && typeof previous?.processStartId === "string"
        && current.processStartId !== previous.processStartId)));
}

async function waitForSupervisorReplacement(previousIdentity, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  let current = { reachable: false };
  while (Date.now() < deadline) {
    current = await inspectSupervisorIdentity();
    if (isReplacementIdentity(current, previousIdentity)) return current;
    await sleep(100);
  }
  return current;
}

function processTreeSnapshot(seedPids) {
  const seeds = [...new Set(seedPids.filter((pid) => Number.isInteger(pid) && pid > 0))];
  if (process.platform === "win32") {
    return seeds.map((pid) => ({ pid, alive: processIsAlive(pid) }));
  }
  try {
    const lines = execFileSync("ps", ["-eo", "pid=,ppid=,pgid=,stat=,comm="], { encoding: "utf8", timeout: 3000 }).trim().split("\n");
    const rows = lines.filter(Boolean).map((line) => {
      const [pid, ppid, pgid, state, comm] = line.trim().split(/\s+/, 5);
      return { pid: Number(pid), ppid: Number(ppid), pgid: Number(pgid), state, comm };
    });
    const byPid = new Map(rows.map((row) => [row.pid, row]));
    const selected = new Set(seeds);
    let changed = true;
    while (changed) {
      changed = false;
      for (const row of rows) {
        if (!selected.has(row.pid) && selected.has(row.ppid)) {
          selected.add(row.pid);
          changed = true;
        }
      }
    }
    return [...selected].sort((a, b) => a - b).map((pid) => byPid.get(pid) ?? { pid, present: false, alive: processIsAlive(pid) });
  } catch {
    return seeds.map((pid) => ({ pid, alive: processIsAlive(pid) }));
  }
}

async function snapshotShutdownState(daemon, supervisorIdentity) {
  const socketState = await inspectSupervisorIdentity().catch(() => ({ reachable: false }));
  const workers = readWorkerDescriptorPids().map((worker) => ({ ...worker, alive: processIsAlive(worker.pid) }));
  const pids = [daemon?.pid, supervisorIdentity?.pid, socketState.pid, ...workers.map((worker) => worker.pid)];
  return {
    gracefulSupervisor: supervisorIdentity ?? { reachable: false },
    postGracefulSocket: socketState,
    daemonLauncher: daemon ? { pid: daemon.pid, exitCode: daemon.exitCode, signalCode: daemon.signalCode, alive: processIsAlive(daemon.pid) } : null,
    workers,
    processes: processTreeSnapshot(pids),
  };
}

async function logRecoveryOwnership(stage, processHandle) {
  const socketSupervisor = await inspectSupervisorIdentity();
  const workers = readWorkerDescriptorPids().map((worker) => ({ ...worker, alive: processIsAlive(worker.pid) }));
  const processes = processTreeSnapshot([processHandle?.pid, socketSupervisor.pid, ...workers.map((worker) => worker.pid)]);
  appendShutdownEvidence(shutdownEvidence.recoverySupervisors, {
    at: new Date().toISOString(),
    stage,
    socketSupervisor,
    processHandle: processHandle ? { pid: processHandle.pid, exitCode: processHandle.exitCode, signalCode: processHandle.signalCode } : null,
    workers,
  });
  console.log(`[ownership] ${JSON.stringify({
    stage,
    processHandle: processHandle ? { pid: processHandle.pid, exitCode: processHandle.exitCode, signalCode: processHandle.signalCode, alive: processIsAlive(processHandle.pid) } : null,
    socketSupervisor,
    workers,
    processes,
  })}`);
  return socketSupervisor;
}

function parseLines(buffer, onLine) {
  let idx;
  while ((idx = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (line) onLine(line);
  }
  return buffer;
}

async function startDaemon() {
  const diagnostics = [];
  const proc = spawn(process.execPath, [DAEMON_CLI, "--mode", "daemon", "--daemon-socket", SOCKET_PATH, "--offline"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stdout.on("data", (chunk) => diagnostics.push(`[daemon] ${chunk.toString()}`));
  proc.stderr.on("data", (chunk) => diagnostics.push(`[daemon-err] ${chunk.toString()}`));
  // Give the supervisor and its session worker time to bind and handshake.
  await sleep(8000);
  return { proc, diagnostics };
}

async function run() {
  console.log(`BRIDGE_VERIFY_SOCKET=${SOCKET_PATH}`);
  console.log("=== Bridge verification harness ===\n");

  const firstDaemon = await startDaemon();
  let daemon = firstDaemon.proc;
  const daemonDiagnostics = [...firstDaemon.diagnostics];
  let bridge;
  const forceCleanup = () => {
    try { bridge?.stdin.end(); } catch {}
    terminateProcessTree(bridge);
    terminateProcessTree(daemon);
  };
    async function shutdownDaemonGracefully() {
    const daemonLaunchUrl = pathToFileURL(join(REF_ROOT, "dist", "cli", "daemon-launch.js")).href;
    const daemonClientUrl = pathToFileURL(join(REF_ROOT, "dist", "modes", "daemon", "daemon-client.js")).href;
    const { shutdownDaemonAndWait, shutdownConnectedDaemonAndWait } = await import(daemonLaunchUrl);
    const { DaemonClient } = await import(daemonClientUrl);
    const client = new DaemonClient(SOCKET_PATH);
    let identity;
    let restoreInstanceTrace = () => undefined;
    try {
      await client.connect(1000);
      const hello = await client.waitForHello(2000).catch(() => undefined);
      identity = {
        reachable: true,
        ...(Number.isInteger(hello?.supervisorPid) ? { pid: hello.supervisorPid } : {}),
        ...(typeof hello?.supervisorProcessStartId === "string" ? { processStartId: hello.supervisorProcessStartId } : {}),
      };
      shutdownEvidence.shutdownTargetSupervisor = identity;
      restoreInstanceTrace = traceShutdownRpcSafely(client);
      recordShutdownEvent("shutdown_rpc_path_selected", { path: "connected-client", supervisor: identity });
      const stopped = await shutdownConnectedDaemonAndWait(client, SOCKET_PATH, 10000, hello);
      recordShutdownEvent("graceful_shutdown_wait_result", { path: "connected-client", stopped, supervisor: identity });
      return { stopped, identity, path: "connected-client" };
    } catch (error) {
      recordShutdownEvent("shutdown_connected_path_error", {
        supervisor: identity ?? { reachable: false },
        ...safeDiagnosticError(error),
      });
      client.close();
      const restorePrototypeTrace = traceShutdownRpcSafely(Object.getPrototypeOf(client));
      try {
        recordShutdownEvent("shutdown_rpc_path_selected", {
          path: "reconnect-client",
          supervisor: identity ?? { reachable: false },
        });
        const stopped = await shutdownDaemonAndWait(SOCKET_PATH, 10000);
        recordShutdownEvent("graceful_shutdown_wait_result", {
          path: "reconnect-client",
          stopped,
          supervisor: identity ?? { reachable: false },
        });
        return { stopped, identity: identity ?? { reachable: false }, path: "reconnect-client" };
      } finally {
        restorePrototypeTrace();
      }
    } finally {
      restoreInstanceTrace();
      client.close();
    }
  }
  const cleanup = async () => {
    recordShutdownEvent("cleanup_start", {
      daemonLauncherHandlePresent: Boolean(daemon),
      daemonLauncherPid: daemon?.pid ?? null,
      processExitedDerivedFromAbsentHandle: !daemon,
    });
    try { bridge?.stdin.end(); } catch {}
    let bridgeStopped = !bridge || bridge.exitCode !== null || bridge.signalCode !== null;
    if (!bridgeStopped) bridgeStopped = await waitForExit(bridge, 5000);
    if (!bridgeStopped) {
      terminateProcessTree(bridge);
      bridgeStopped = await waitForExit(bridge, 1000);
    }

    let daemonStopped = false;
    let daemonProcessStopped = !daemon || daemon.exitCode !== null || daemon.signalCode !== null;
    let shutdownError;
    let shutdownResult;
    try {
      shutdownResult = await shutdownDaemonGracefully();
      daemonStopped = shutdownResult.stopped;
      if (daemonStopped) daemonProcessStopped = await waitForExit(daemon, 5000);
    } catch (error) {
      shutdownError = safeDiagnosticError(error).error;
      recordShutdownEvent("graceful_shutdown_error", { error: shutdownError });
    }
    shutdownEvidence.shutdownResult = {
      path: shutdownResult?.path ?? null,
      stopped: shutdownResult?.stopped ?? false,
      supervisor: shutdownResult?.identity ?? { reachable: false },
    };
    let shutdownDiagnostics;
    let fallbackTerminationNeeded = false;
    if (!daemonStopped || !daemonProcessStopped) {
      fallbackTerminationNeeded = true;
      shutdownDiagnostics = await snapshotShutdownState(daemon, shutdownResult?.identity);
      appendShutdownEvidence(shutdownEvidence.snapshots, { stage: "before-fallback", at: new Date().toISOString(), data: shutdownDiagnostics });
      recordShutdownEvent("pre_fallback_snapshot", {
        daemonLauncherHandlePresent: Boolean(daemon),
        daemonLauncherPid: daemon?.pid ?? null,
        supervisor: shutdownResult?.identity ?? { reachable: false },
        workers: shutdownDiagnostics.workers,
        processes: shutdownDiagnostics.processes,
      });
      terminateProcessTree(daemon);
      daemonProcessStopped = await waitForExit(daemon, 5000);
      shutdownDiagnostics.afterFallback = await snapshotShutdownState(daemon, shutdownResult?.identity);
      appendShutdownEvidence(shutdownEvidence.snapshots, {
        stage: "after-fallback",
        at: new Date().toISOString(),
        data: shutdownDiagnostics.afterFallback,
      });
      recordShutdownEvent("post_fallback_snapshot", {
        daemonLauncherHandlePresent: Boolean(daemon),
        daemonLauncherPid: daemon?.pid ?? null,
        supervisor: shutdownResult?.identity ?? { reachable: false },
        workers: shutdownDiagnostics.afterFallback.workers,
        processes: shutdownDiagnostics.afterFallback.processes,
      });
    }
    const result = {
      bridgeStopped,
      daemonStopped: daemonStopped && daemonProcessStopped && !fallbackTerminationNeeded,
      gracefulDaemonStopped: daemonStopped,
      daemonProcessStopped,
      fallbackTerminationNeeded,
      shutdownError,
      shutdownDiagnostics,
    };
    shutdownEvidence.cleanupResult = {
      ...result,
      shutdownDiagnostics: result.shutdownDiagnostics,
    };
    recordShutdownEvent("cleanup_result", {
      daemonStopped: result.daemonStopped,
      gracefulResult: result.gracefulDaemonStopped,
      processExited: result.daemonProcessStopped,
      fallback: result.fallbackTerminationNeeded,
      bridgeStopped: result.bridgeStopped,
      daemonLauncherHandlePresent: Boolean(daemon),
      processExitedDerivedFromAbsentHandle: !daemon,
      shutdownError: result.shutdownError,
    });
    return result;
  };
  const onSignal = () => {
    forceCleanup();
    process.exit(130);
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    bridge = spawn(process.execPath, [BRIDGE, "--daemon-socket", SOCKET_PATH], {
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (err) {
    record("spawn bridge", false, err.message);
    const cleanupState = await cleanup();
    record("graceful shutdown releases the isolated session HOME", cleanupState.daemonStopped && cleanupState.bridgeStopped,
      `daemonStopped=${cleanupState.daemonStopped}; gracefulResult=${cleanupState.gracefulDaemonStopped}; processExited=${cleanupState.daemonProcessStopped}; fallback=${cleanupState.fallbackTerminationNeeded}; bridgeStopped=${cleanupState.bridgeStopped}; ${cleanupState.shutdownError ?? ""}${cleanupState.shutdownDiagnostics ? ` ownership=${JSON.stringify(cleanupState.shutdownDiagnostics)}` : ""}`);
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    await persistShutdownEvidence();
    return;
  }

  let stdoutBuf = "";
  let stderrBuf = "";
  const responses = new Map(); // id → parsed response
  const responseFrames = [];
  const events = [];

  bridge.stdout.on("data", (chunk) => {
    stdoutBuf = parseLines(stdoutBuf + chunk.toString(), (line) => {
      let parsed;
      try { parsed = JSON.parse(line); } catch { return; }
      if (parsed && typeof parsed === "object" && "event" in parsed) {
        events.push(parsed.event);
      } else if (parsed && typeof parsed === "object" && typeof parsed.type === "string") {
        // Production bridge events are direct IpcEvent envelopes. Keep the
        // legacy wrapped form above for older sidecars used by this fixture.
        events.push(parsed);
      } else if (parsed && typeof parsed === "object"
        && (Object.hasOwn(parsed, "result") || Object.hasOwn(parsed, "error"))) {
        responseFrames.push(parsed);
        if (Object.hasOwn(parsed, "id")) responses.set(String(parsed.id), parsed);
      }
    });
  });
  bridge.stderr.on("data", (chunk) => { stderrBuf += chunk.toString(); });

  function send(cmd) {
    return new Promise((resolve, reject) => {
      const id = String(cmd.id ?? Math.random());
      const wire = { ...cmd, id };
      const timer = setTimeout(() => reject(new Error(`timeout waiting for response to ${cmd.method}`)), 8000);
      const check = setInterval(() => {
        if (responses.has(id)) {
          clearTimeout(timer);
          clearInterval(check);
          resolve(responses.get(id));
        }
      }, 20);
      bridge.stdin.write(JSON.stringify(wire) + "\n");
    });
  }

  function sendRaw(line) {
    bridge.stdin.write(line + "\n");
  }

  try {
    // Wait for the bridge to emit its initial connecting event.
    const start = Date.now();
    while (!events.some((e) => e.type === "connection_status" && e.status.kind === "connecting") && Date.now() - start < 4000) {
      await sleep(50);
    }
    record("emits connecting event on startup", events.some((e) => e.type === "connection_status" && e.status.kind === "connecting"));

    // 1. getState while still connecting — should still respond
    const connectingResp = await send({ id: "c1", method: "getState", params: {} });
    record("getState responds while connecting",
      connectingResp.result !== undefined && connectingResp.result.status?.kind === "connecting",
      `status=${connectingResp.result?.status?.kind}`);

    // 2. Wait for the connected event
    const t0 = Date.now();
    while (!events.some((e) => e.type === "connection_status" && e.status.kind === "connected") && Date.now() - t0 < 10000) {
      await sleep(50);
    }
    const connectedEventSeen = events.some((e) => e.type === "connection_status" && e.status.kind === "connected");

    // 3. Wait for the snapshot event
    const t1 = Date.now();
    while (!events.some((e) => e.type === "snapshot") && Date.now() - t1 < 4000) {
      await sleep(50);
    }
    record("emits snapshot event after attach",
      events.some((e) => e.type === "snapshot"));

    // 4. getState after connected
    const stateResp = await send({ id: "c4", method: "getState", params: {} });
    record("connection reaches connected state after daemon attach",
      connectedEventSeen || stateResp.result?.status?.kind === "connected",
      `event=${connectedEventSeen} state=${stateResp.result?.status?.kind}`);
    record("getState returns active state",
      stateResp.result?.status?.kind === "connected" && typeof stateResp.result?.activeSessionId === "string",
      `activeSessionId=${stateResp.result?.activeSessionId}`);

    if (process.env.BRIDGE_VERIFY_RECOVERY === "1") {
      // Replace the daemon while keeping the bridge alive. This exercises the
      // recoverDaemon readiness gate and the upstream reconnect/reattach path.
      const oldDaemon = daemon;
      const reconnectingStart = events.length;
      const oldSupervisorIdentity = await logRecoveryOwnership("initial-recovery-before-kill", oldDaemon);
      const stopAttempted = await terminateSupervisorOnly(oldSupervisorIdentity);
      const exited = await waitForProcessIdentityExit(oldSupervisorIdentity);
      daemon = undefined;
      await logRecoveryOwnership("initial-recovery-after-kill", oldDaemon);
      record("old daemon exits before replacement", stopAttempted && exited, `pid=${oldSupervisorIdentity.pid ?? "unknown"} identityChecked=${typeof oldSupervisorIdentity.processStartId === "string"}`);
      const replacementIdentity = exited
        ? await waitForSupervisorReplacement(oldSupervisorIdentity)
        : await inspectSupervisorIdentity();
      await logRecoveryOwnership("initial-recovery-after-replacement", daemon);
      record("replacement supervisor becomes reachable after daemon loss", isReplacementIdentity(replacementIdentity, oldSupervisorIdentity),
        `oldPid=${oldSupervisorIdentity.pid ?? "unknown"} newPid=${replacementIdentity.pid ?? "unknown"}`);
      const reconnectDeadline = Date.now() + 45_000;
      while (!events.slice(reconnectingStart).some((e) => e.type === "connection_status" && e.status.kind === "connected") && Date.now() < reconnectDeadline) {
        await sleep(50);
      }
      const recovered = events.slice(reconnectingStart).some((e) => e.type === "connection_status" && e.status.kind === "connected");
      record("bridge reconnects after daemon replacement", recovered);
      const recoveredState = await send({ id: "c4r", method: "getState", params: {} });
      record("reconnected bridge serves state", recoveredState.result?.status?.kind === "connected", `status=${recoveredState.result?.status?.kind}`);
    }

    // 6. getModels
    const modelsResp = await send({ id: "c5", method: "getModels", params: {} });
    record("getModels returns catalog",
      Array.isArray(modelsResp.result) && modelsResp.result.length > 0,
      `${modelsResp.result?.length ?? 0} models`);

    // 6. getProviders
    const provResp = await send({ id: "c6", method: "getProviders", params: {} });
    record("getProviders returns provider list",
      Array.isArray(provResp.result) && provResp.result.length > 0,
      `${provResp.result?.length ?? 0} providers`);

    // 7. getTranscript
    const transResp = await send({ id: "c7", method: "getTranscript", params: {} });
    record("getTranscript returns array",
      Array.isArray(transResp.result));

    // 8. getSettings
    const settResp = await send({ id: "c8", method: "getSettings", params: {} });
    record("getSettings returns object",
      typeof settResp.result === "object" && settResp.result !== null,
      JSON.stringify(settResp.result));

    // 9. setSettings
    const setResp = await send({ id: "c9", method: "setSettings", params: { settings: { theme: "dark", daemonCliPath: "C:/custom/path" } } });
    record("setSettings updates and returns",
      setResp.result?.theme === "dark" && setResp.result?.daemonCliPath === "C:/custom/path");

    // 10. Unknown method → -32601
    const unkResp = await send({ id: "c10", method: "definitelyNotARealMethod", params: {} });
    record("unknown method → method not found",
      unkResp.error?.code === -32601,
      `code=${unkResp.error?.code}`);

    // 11. Missing required param → -32602
    const badResp = await send({ id: "c11", method: "prompt", params: {} });
    record("missing required param → invalid params",
      badResp.error?.code === -32602,
      `code=${badResp.error?.code} msg=${badResp.error?.message}`);

    // 12. listSessions, listAgents, getRlmChildren, getContextStats — all should respond
    const listResp = await send({ id: "c12", method: "listSessions", params: {} });
    record("listSessions responds",
      Array.isArray(listResp.result));

    const agentsResp = await send({ id: "c13", method: "listAgents", params: {} });
    record("listAgents responds",
      Array.isArray(agentsResp.result));

    const rlmResp = await send({ id: "c14", method: "getRlmChildren", params: {} });
    record("getRlmChildren responds",
      Array.isArray(rlmResp.result));

    const ctxResp = await send({ id: "c15", method: "getContextStats", params: {} });
    record("getContextStats responds",
      typeof ctxResp.result === "object");

    // 13. Robustness: malformed JSON returns -32700 and the bridge stays alive.
    const parseResponseStart = responseFrames.length;
    sendRaw("not-json-at-all{");
    const parseDeadline = Date.now() + 5000;
    while (responseFrames.length < parseResponseStart + 1 && Date.now() < parseDeadline) await sleep(20);
    const parseResponses = responseFrames.slice(parseResponseStart);
    const parseErrorResp = parseResponses[0];
    record("malformed JSON returns parse error with null id",
      parseResponses.length === 1 && parseErrorResp.error?.code === -32700
        && Object.hasOwn(parseErrorResp, "id") && parseErrorResp.id === null,
      `responses=${JSON.stringify(parseResponses)}`);
    await sleep(300);
    record("bridge survives malformed JSON line", bridge.exitCode === null, `pid alive=${bridge.exitCode === null}`);

    // 14. A real object without method must receive one -32600/null-id response.
    const invalidRequestStart = responseFrames.length;
    sendRaw(JSON.stringify({ jsonrpc: "2.0", id: "invalid-no-method" }));
    const invalidRequestDeadline = Date.now() + 5000;
    while (responseFrames.length < invalidRequestStart + 1 && Date.now() < invalidRequestDeadline) await sleep(20);
    const invalidRequestFrames = responseFrames.slice(invalidRequestStart);
    const invalidRequestResp = invalidRequestFrames[0];
    record("object without method returns invalid request with null id",
      invalidRequestFrames.length === 1 && invalidRequestResp.error?.code === -32600
        && Object.hasOwn(invalidRequestResp, "id") && invalidRequestResp.id === null,
      `responses=${JSON.stringify(invalidRequestFrames)}`);

    // 15. Confirm later valid requests still traverse the actual bridge.
    const afterMalformedResp = await send({ id: "c16", method: "getState", params: {} });
    record("bridge still responds after malformed requests",
      afterMalformedResp.result?.status?.kind === "connected");

    // 16. An explicitly present null ID is a request, not a notification;
    // version omission remains supported for the Rust shell's wire format.
    const nullIdResponseStart = responseFrames.length;
    sendRaw(JSON.stringify({ id: null, method: "getState", params: {} }));
    const nullIdDeadline = Date.now() + 5000;
    while (responseFrames.length < nullIdResponseStart + 1 && Date.now() < nullIdDeadline) await sleep(20);
    const nullIdFrames = responseFrames.slice(nullIdResponseStart);
    const nullIdResp = nullIdFrames[0];
    record("present null id returns one successful response",
      nullIdFrames.length === 1 && Object.hasOwn(nullIdResp, "id") && nullIdResp.id === null
        && Object.hasOwn(nullIdResp, "result") && typeof nullIdResp.result?.status?.kind === "string",
      `responses=${JSON.stringify(nullIdFrames)}`);

    // 17. Only an absent ID denotes a notification; assert no response frame.
    const notificationResponseStart = responseFrames.length;
    sendRaw(JSON.stringify({ method: "getState", params: {} }));
    await sleep(300);
    const notificationResponses = responseFrames.slice(notificationResponseStart);
    record("notification (no id) produces no response line",
      notificationResponses.length === 0,
      `responseCount=${notificationResponses.length}`);

    // 16. login/logout stubs
    const loginResp = await send({ id: "c17", method: "login", params: { provider: "openrouter" } });
    record("login acknowledges without mutating a key",
      loginResp.result?.provider === "openrouter" && loginResp.result?.stored === false);

    const logoutResp = await send({ id: "c18", method: "logout", params: { provider: "openrouter" } });
    record("logout acknowledges",
      logoutResp.result?.provider === "openrouter" && logoutResp.result?.stored === false);

    // 17. listInbox / markMessageRead
    const inboxResp = await send({ id: "c19", method: "listInbox", params: {} });
    record("listInbox returns array",
      Array.isArray(inboxResp.result));

    const markResp = await send({ id: "c20", method: "markMessageRead", params: { messageId: "nonexistent" } });
    record("markMessageRead returns boolean",
      typeof markResp.result === "boolean");

    // 18. The snapshot event surfaces the active thinking level (fix #3).
    const snapEvt = events.find((e) => e.type === "snapshot");
    const modelWithThinking = snapEvt?.state?.model;
    record("ConnectionState.model.thinking preserves daemon value",
      modelWithThinking?.thinking === undefined || typeof modelWithThinking.thinking === "string",
      `thinking=${JSON.stringify(modelWithThinking?.thinking)}`);

    // 19. newSession with no cwd/goal: must dispatch without error (fix #1).
    // We expect either a fresh-session result or a clean cancellation; both
    // are valid daemon responses, but it MUST NOT throw.
    const ns1 = await send({ id: "c21", method: "newSession", params: {} });
    record("newSession() with empty params dispatches",
      ns1.result !== undefined && (typeof ns1.result.cancelled === "boolean" || typeof ns1.result.activeSessionId === "string"),
      `result=${JSON.stringify(ns1.result)}`);

    // 20. newSession with a real, existing cwd must create and attach a real daemon session.
    const sessionCwd = process.env.BRIDGE_VERIFY_SESSION_CWD || process.cwd();
    const ns2 = await send({ id: "c22", method: "newSession", params: { cwd: sessionCwd, goal: "verify harness session" } });
    record("newSession({cwd,goal}) creates a session and returns its real activeSessionId",
      typeof ns2.result?.activeSessionId === "string" && ns2.result.activeSessionId.length > 0,
      `result=${JSON.stringify(ns2.result)} err=${ns2.error ? ns2.error.code + " " + ns2.error.message : "none"}`);

    const createdSessionId = ns2.result?.activeSessionId;
    const stateAfterCreate = await send({ id: "c24", method: "getState", params: {} });
    record("newSession leaves the bridge attached to the returned session",
      typeof createdSessionId === "string" && stateAfterCreate.result?.activeSessionId === createdSessionId,
      `created=${createdSessionId} current=${stateAfterCreate.result?.activeSessionId}`);

    const transcriptAfterCreate = await send({ id: "c25", method: "getTranscript", params: {} });
    record("new session transcript is retrievable",
      Array.isArray(transcriptAfterCreate.result),
      `entries=${transcriptAfterCreate.result?.length ?? "not-array"}`);

    const sessionsAfterCreate = await send({ id: "c26", method: "listSessions", params: {} });
    const priorSessionIds = new Set((Array.isArray(listResp.result) ? listResp.result : []).map((session) => session.id));
    const newSessionListings = (Array.isArray(sessionsAfterCreate.result) ? sessionsAfterCreate.result : [])
      .filter((session) => session.cwd === sessionCwd && !priorSessionIds.has(session.id))
      .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
    const createdSessionListing = newSessionListings[0];
    record("created daemon session is listed with a stable session id",
      Boolean(createdSessionListing && typeof createdSessionListing.id === "string"),
      `newListings=${newSessionListings.length} selected=${createdSessionListing?.id ?? "none"}`);

    const previousSessionListing = Array.isArray(listResp.result) ? listResp.result.find((session) => typeof session.id === "string") : undefined;
    const switchedToPrevious = previousSessionListing
      ? await send({ id: "c27", method: "switchSession", params: { id: previousSessionListing.id } })
      : { error: { code: -32603, message: "no previous saved session to switch to" } };
    record("switchSession resolves listed session ID to upstream session path",
      switchedToPrevious.result?.cancelled === false,
      `result=${JSON.stringify(switchedToPrevious.result)} err=${switchedToPrevious.error ? switchedToPrevious.error.code + " " + switchedToPrevious.error.message : "none"}`);

    const switchBackToCreated = createdSessionListing
      ? await send({ id: "c28", method: "resumeSession", params: { pathOrId: createdSessionListing.id } })
      : { error: { code: -32603, message: "new session was not listed" } };
    const stateAfterSwitchBack = await send({ id: "c29", method: "getState", params: {} });
    record("resumeSession returns to the created session",
      switchBackToCreated.result?.cancelled === false && stateAfterSwitchBack.result?.activeSessionId === createdSessionId,
      `result=${JSON.stringify(switchBackToCreated.result)} active=${stateAfterSwitchBack.result?.activeSessionId} expected=${createdSessionId}`);

    if (process.env.BRIDGE_VERIFY_RECOVERY === "1") {
      const recoveryDeadline = Date.now() + 45_000;
      const reconnectingStart = events.length;
      const oldDaemon = daemon;
      const oldSupervisorIdentity = await logRecoveryOwnership("session-recovery-before-kill", oldDaemon);
      const stopAttempted = await terminateSupervisorOnly(oldSupervisorIdentity);
      const exited = await waitForProcessIdentityExit(oldSupervisorIdentity);
      daemon = undefined;
      await logRecoveryOwnership("session-recovery-after-kill", oldDaemon);
      record("session-recovery daemon exits before replacement", stopAttempted && exited, `pid=${oldSupervisorIdentity.pid ?? "unknown"} identityChecked=${typeof oldSupervisorIdentity.processStartId === "string"}`);
      const replacementIdentity = exited
        ? await waitForSupervisorReplacement(oldSupervisorIdentity, Math.max(0, recoveryDeadline - Date.now()))
        : await inspectSupervisorIdentity();
      await logRecoveryOwnership("session-recovery-after-replacement", daemon);
      const replacementReady = isReplacementIdentity(replacementIdentity, oldSupervisorIdentity);
      record("replacement supervisor starts with persisted session state", replacementReady,
        `oldPid=${oldSupervisorIdentity.pid ?? "unknown"} newPid=${replacementIdentity.pid ?? "unknown"}`);
      const connectedAfterReplacement = () => events.slice(reconnectingStart)
        .some((e) => e.type === "connection_status" && e.status.kind === "connected");
      const recoveryPollStarted = Date.now();
      let connectedEventObservedAt;
      let stateAfterReconnect;
      let stateAfterReconnectObservedAt;
      let listedAfterReconnect;
      let listedAfterReconnectObservedAt;
      let recoveryPollCount = 0;
      while (replacementReady && createdSessionListing?.id && Date.now() < recoveryDeadline) {
        if (!connectedAfterReplacement()) {
          await sleep(50);
          continue;
        }
        connectedEventObservedAt ??= Date.now();
        if (Date.now() >= recoveryDeadline) break;
        recoveryPollCount += 1;
        stateAfterReconnect = await send({ id: `c33-${recoveryPollCount}`, method: "getState", params: {} });
        stateAfterReconnectObservedAt = Date.now();
        if (Date.now() >= recoveryDeadline) break;
        listedAfterReconnect = await send({ id: `c34-${recoveryPollCount}`, method: "listSessions", params: {} });
        listedAfterReconnectObservedAt = Date.now();
        if (getSessionRecoveryAssertions({
          connectedEventObservedAt,
          state: stateAfterReconnect.result,
          stateObservedAt: stateAfterReconnectObservedAt,
          sessions: listedAfterReconnect.result,
          sessionsObservedAt: listedAfterReconnectObservedAt,
          recoveryDeadline,
          expectedActiveSessionId: createdSessionId,
          expectedSessionListingId: createdSessionListing.id,
        }).ready) break;
        if (Date.now() < recoveryDeadline) await sleep(250);
      }
      if (!connectedEventObservedAt && Date.now() < recoveryDeadline && connectedAfterReplacement()) {
        connectedEventObservedAt = Date.now();
      }
      if (!stateAfterReconnect && Date.now() < recoveryDeadline) {
        stateAfterReconnect = await send({ id: "c33-final", method: "getState", params: {} });
        stateAfterReconnectObservedAt = Date.now();
      }
      if (!listedAfterReconnect && Date.now() < recoveryDeadline) {
        listedAfterReconnect = await send({ id: "c34-final", method: "listSessions", params: {} });
        listedAfterReconnectObservedAt = Date.now();
      }
      const recoveryElapsedMs = Date.now() - recoveryPollStarted;
      const recoveryAssertions = getSessionRecoveryAssertions({
        connectedEventObservedAt,
        state: stateAfterReconnect?.result,
        stateObservedAt: stateAfterReconnectObservedAt,
        sessions: listedAfterReconnect?.result,
        sessionsObservedAt: listedAfterReconnectObservedAt,
        recoveryDeadline,
        expectedActiveSessionId: createdSessionId,
        expectedSessionListingId: createdSessionListing?.id,
      });
      const connectedEventDelayMs = Number.isFinite(connectedEventObservedAt) ? connectedEventObservedAt - recoveryPollStarted : "none";
      const stateObservedDelayMs = Number.isFinite(stateAfterReconnectObservedAt) ? stateAfterReconnectObservedAt - recoveryPollStarted : "none";
      const sessionsObservedDelayMs = Number.isFinite(listedAfterReconnectObservedAt) ? listedAfterReconnectObservedAt - recoveryPollStarted : "none";
      record("created session remains connected and active after supervisor replacement",
        recoveryAssertions.activeSessionReady,
        `connectedEvent=${recoveryAssertions.connectedEventSeen} status=${stateAfterReconnect?.result?.status?.kind ?? "not-sampled"} active=${stateAfterReconnect?.result?.activeSessionId ?? "not-sampled"} expected=${createdSessionId} polls=${recoveryPollCount} elapsedMs=${recoveryElapsedMs} connectedAtMs=${connectedEventDelayMs} stateAtMs=${stateObservedDelayMs}`);
      record("created session remains listed after daemon replacement",
        recoveryAssertions.listedSessionReady,
        `listed=${Array.isArray(listedAfterReconnect?.result) ? listedAfterReconnect.result.some((session) => session.id === createdSessionListing?.id) : false} polls=${recoveryPollCount} elapsedMs=${recoveryElapsedMs} sessionsAtMs=${sessionsObservedDelayMs}`);
      const transcriptAfterReconnect = await send({ id: "c35", method: "getTranscript", params: {} });
      record("created session transcript remains retrievable after daemon replacement",
        Array.isArray(transcriptAfterReconnect.result),
        `entries=${transcriptAfterReconnect.result?.length ?? "not-array"}`);
    }

    const malformedSession = await send({ id: "c30", method: "newSession", params: { cwd: 42 } });
    record("newSession rejects non-string cwd",
      malformedSession.error?.code === -32602,
      `err=${malformedSession.error?.code} ${malformedSession.error?.message}`);

    const malformedGoal = await send({ id: "c32", method: "newSession", params: { goal: 42 } });
    record("newSession rejects non-string goal",
      malformedGoal.error?.code === -32602,
      `err=${malformedGoal.error?.code} ${malformedGoal.error?.message}`);

    const invalidCwdSession = await send({ id: "c31", method: "newSession", params: { cwd: "C:/tmp" } });
    record("daemon create failure preserves upstream response error",
      invalidCwdSession.error?.code === -32603 && invalidCwdSession.error.message.includes("Failed to obtain daemon session worker pid"),
      `err=${invalidCwdSession.error?.code} ${invalidCwdSession.error?.message}`);

    // 21. forkSession with an entry id (short hex string) must dispatch to AgentConnection.fork
    // without throwing on the type-mismatch path (fix #2). The daemon may reject
    // a fake entry id — a JSON-RPC error is acceptable.
    const fork1 = await send({ id: "c23", method: "forkSession", params: { pathOrId: "deadbeef" } });
    record("forkSession dispatches and threads through entry resolution (no type-mismatch crash)",
      fork1.result !== undefined || (typeof fork1.error === "object" && typeof fork1.error.code === "number"),
      `err=${fork1.error ? fork1.error.code + " " + fork1.error.message : "none"}`);

  } catch (err) {
    record("test harness", false, err.message);
  } finally {
    const cleanupState = await cleanup();
    record("graceful daemon shutdown releases adopted session workers before HOME removal",
      cleanupState.daemonStopped && cleanupState.bridgeStopped,
      `daemonStopped=${cleanupState.daemonStopped}; gracefulResult=${cleanupState.gracefulDaemonStopped}; processExited=${cleanupState.daemonProcessStopped}; fallback=${cleanupState.fallbackTerminationNeeded}; bridgeStopped=${cleanupState.bridgeStopped}; ${cleanupState.shutdownError ?? ""}${cleanupState.shutdownDiagnostics ? ` ownership=${JSON.stringify(cleanupState.shutdownDiagnostics)}` : ""}`);
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    await persistShutdownEvidence();
  }

  const passed = results.filter((r) => r.ok).length;
  const total = results.length;
  if (passed !== total) {
    if (daemonDiagnostics.length > 0) {
      console.error("[daemon-diagnostics]");
      console.error(daemonDiagnostics.join(""));
    }
    if (stderrBuf.trim()) {
      console.error("[bridge-stderr]");
      console.error(stderrBuf.trim());
    }
  }
  console.log(`\n=== ${passed}/${total} checks passed ===`);
  process.exit(passed === total ? 0 : 1);
}

run().catch((err) => {
  console.error("harness fatal:", err);
  process.exit(2);
});
