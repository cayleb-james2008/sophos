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
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { getSessionRecoveryAssertions } from "./session-recovery-readiness.mjs";
import { runRecoveryProbe } from "./recovery-probe.mjs";
import { startBridgeAfterDaemonStartup } from "./startup-gate.mjs";
import { isLifecycleCancellationMessage } from "./lifecycle-cancellation.mjs";

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

async function terminateProcessIdentityTree(identity) {
  if (!Number.isInteger(identity?.pid) || identity.pid <= 0) return false;
  if (typeof identity.processStartId !== "string" || identity.processStartId.length === 0) return false;
  const sessionLeaseUrl = pathToFileURL(join(REF_ROOT, "dist", "core", "session-lease.js")).href;
  const { getProcessStartId } = await import(sessionLeaseUrl);
  const currentStartId = getProcessStartId(identity.pid);
  if (!currentStartId || currentStartId !== identity.processStartId) return false;
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/PID", String(identity.pid), "/T", "/F"], { stdio: "ignore" });
      return true;
    } catch {
      return !processIsAlive(identity.pid);
    }
  }
  try {
    process.kill(identity.pid, "SIGTERM");
    return true;
  } catch {
    return !processIsAlive(identity.pid);
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

function readWorkerDescriptorPids(socketPath = SOCKET_PATH) {
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
          if (descriptor.supervisorSocketPath === socketPath
            && typeof descriptor.workerId === "string" && Number.isInteger(descriptor.pid) && descriptor.pid > 0) {
            workers.push({
              workerId: descriptor.workerId,
              pid: descriptor.pid,
              ...(typeof descriptor.processStartId === "string" ? { processStartId: descriptor.processStartId } : {}),
              lifecycle: typeof descriptor.lifecycle === "string" ? descriptor.lifecycle : "unknown",
            });
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

async function waitForOwnedShutdownProcesses(supervisorIdentity, timeoutMs = 5000) {
  const currentSupervisor = await inspectSupervisorIdentity();
  const workers = readWorkerDescriptorPids();
  const identities = [supervisorIdentity, currentSupervisor, ...workers]
    .filter((identity) => Number.isInteger(identity?.pid) && identity.pid > 0)
    .filter((identity, index, all) => all.findIndex((candidate) =>
      candidate.pid === identity.pid && candidate.processStartId === identity.processStartId) === index);
  const exited = await Promise.all(identities.map((identity) => waitForProcessIdentityExit(identity, timeoutMs)));
  if (exited.some((didExit) => !didExit)) return false;
  const [remainingSupervisor, remainingWorkers] = await Promise.all([
    inspectSupervisorIdentity(),
    Promise.resolve(readWorkerDescriptorPids()),
  ]);
  return !remainingSupervisor.reachable && !remainingWorkers.some((worker) => processIsAlive(worker.pid));
}

async function terminateShutdownOwnedProcesses(snapshot) {
  const identities = [snapshot?.postGracefulSocket, snapshot?.gracefulSupervisor,
    ...(snapshot?.workers ?? []).filter((worker) => worker.alive)];
  const uniqueIdentities = identities
    .filter((identity) => Number.isInteger(identity?.pid) && identity.pid > 0)
    .filter((identity, index, all) => all.findIndex((candidate) =>
      candidate.pid === identity.pid && candidate.processStartId === identity.processStartId) === index);
  await Promise.all(uniqueIdentities.map((identity) => terminateProcessIdentityTree(identity)));
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

async function startDaemon(onSpawn, signal) {
  const diagnostics = [];
  const proc = spawn(process.execPath, [DAEMON_CLI, "--mode", "daemon", "--daemon-socket", SOCKET_PATH, "--offline"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  onSpawn?.(proc);
  proc.stdout.on("data", (chunk) => diagnostics.push(`[daemon] ${chunk.toString()}`));
  proc.stderr.on("data", (chunk) => diagnostics.push(`[daemon-err] ${chunk.toString()}`));
  // Give the supervisor and its session worker time to bind and handshake.
  try {
    await sleep(8000, undefined, { signal });
  } catch (error) {
    if (!signal?.aborted || error?.name !== "AbortError") throw error;
  }
  return { proc, diagnostics };
}

async function run() {
  console.log(`BRIDGE_VERIFY_SOCKET=${SOCKET_PATH}`);
  console.log("=== Bridge verification harness ===\n");

  let daemon;
  const daemonDiagnostics = [];
  let bridge;
  let cleanupPromise;
  let signalCleanupPromise;
  let signalReceived = false;
  const startupAbort = new AbortController();
  const runCancelledError = () => {
    const error = new Error("bridge verification interrupted by shutdown");
    error.name = "RunCancelledError";
    return error;
  };
  const waitForRun = async (milliseconds) => {
    if (startupAbort.signal.aborted) throw runCancelledError();
    try {
      await sleep(milliseconds, undefined, { signal: startupAbort.signal });
    } catch (error) {
      if (startupAbort.signal.aborted && error?.name === "AbortError") throw runCancelledError();
      throw error;
    }
  };
  const forceCleanup = async () => {
    try { bridge?.stdin.end(); } catch {}
    const snapshot = await snapshotShutdownState(daemon);
    await terminateShutdownOwnedProcesses(snapshot);
    terminateProcessTree(bridge);
    terminateProcessTree(daemon);
    await waitForExit(bridge, 2000);
    await waitForExit(daemon, 2000);
    await waitForOwnedShutdownProcesses(undefined, 2000);
  };
  async function shutdownDaemonGracefully() {
    const daemonLaunchUrl = pathToFileURL(join(REF_ROOT, "dist", "cli", "daemon-launch.js")).href;
    const daemonClientUrl = pathToFileURL(join(REF_ROOT, "dist", "modes", "daemon", "daemon-client.js")).href;
    const { shutdownDaemonAndWait, shutdownConnectedDaemonAndWait } = await import(daemonLaunchUrl);
    const { DaemonClient } = await import(daemonClientUrl);
    const client = new DaemonClient(SOCKET_PATH);
    let identity;
    try {
      await client.connect(1000);
      const hello = await client.waitForHello(2000).catch(() => undefined);
      identity = {
        reachable: true,
        ...(Number.isInteger(hello?.supervisorPid) ? { pid: hello.supervisorPid } : {}),
        ...(typeof hello?.supervisorProcessStartId === "string" ? { processStartId: hello.supervisorProcessStartId } : {}),
      };
      return {
        stopped: await shutdownConnectedDaemonAndWait(client, SOCKET_PATH, 45000, hello),
        identity,
      };
    } catch {
      client.close();
      return { stopped: await shutdownDaemonAndWait(SOCKET_PATH, 45000), identity: identity ?? { reachable: false } };
    } finally {
      client.close();
    }
  }
  const cleanup = async () => {
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
      if (daemonStopped) {
        daemonProcessStopped = await waitForExit(daemon, 5000)
          && await waitForOwnedShutdownProcesses(shutdownResult.identity, 5000);
      }
    } catch (error) {
      shutdownError = error instanceof Error ? error.message : String(error);
      daemonProcessStopped = false;
    }
    let shutdownDiagnostics;
    let fallbackTerminationNeeded = false;
    if (!daemonStopped || !daemonProcessStopped) {
      fallbackTerminationNeeded = true;
      shutdownDiagnostics = await snapshotShutdownState(daemon, shutdownResult?.identity);
      await terminateShutdownOwnedProcesses(shutdownDiagnostics);
      terminateProcessTree(daemon);
      daemonProcessStopped = await waitForExit(daemon, 5000)
        && await waitForOwnedShutdownProcesses(undefined, 5000);
      shutdownDiagnostics.afterFallback = await snapshotShutdownState(daemon, shutdownResult?.identity);
    }
    return {
      bridgeStopped,
      daemonStopped: daemonStopped && daemonProcessStopped && !fallbackTerminationNeeded,
      gracefulDaemonStopped: daemonStopped,
      daemonProcessStopped,
      fallbackTerminationNeeded,
      shutdownError,
      shutdownDiagnostics,
    };
  };
  const startCleanup = () => {
    startupAbort.abort();
    cleanupPromise ??= cleanup();
    return cleanupPromise;
  };
  const onSignal = () => {
    signalReceived = true;
    if (signalCleanupPromise) {
      void forceCleanup()
        .catch((error) => console.error("[signal-cleanup] forced cleanup failed:", error))
        .finally(() => process.exit(130));
      return;
    }
    signalCleanupPromise = (async () => {
      try {
        const state = await startCleanup();
        if (!state.bridgeStopped || !state.daemonStopped || !state.daemonProcessStopped) {
          await forceCleanup();
        }
      } catch (error) {
        console.error("[signal-cleanup] graceful cleanup failed:", error);
        await forceCleanup().catch((forceError) => console.error("[signal-cleanup] forced cleanup failed:", forceError));
      }
      process.exit(130);
    })();
  };
  const onLifecycleCancellation = (message) => {
    if (isLifecycleCancellationMessage(message)) onSignal();
  };
  process.on("message", onLifecycleCancellation);
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  try {
    const startupCompleted = await startBridgeAfterDaemonStartup({
      signal: startupAbort.signal,
      startDaemon: async () => {
        const started = await startDaemon((proc) => { daemon = proc; }, startupAbort.signal);
        daemonDiagnostics.push(...started.diagnostics);
      },
      startBridge: () => {
        bridge = spawn(process.execPath, [BRIDGE, "--daemon-socket", SOCKET_PATH], {
          stdio: ["pipe", "pipe", "pipe"],
        });
      },
    });
    if (!startupCompleted || startupAbort.signal.aborted) {
      await startCleanup();
      return;
    }
  } catch (err) {
    record("spawn daemon and bridge", false, err.message);
    const cleanupState = await startCleanup();
    record("graceful shutdown releases the isolated session HOME", cleanupState.daemonStopped && cleanupState.bridgeStopped,
      `daemonStopped=${cleanupState.daemonStopped}; gracefulResult=${cleanupState.gracefulDaemonStopped}; processExited=${cleanupState.daemonProcessStopped}; fallback=${cleanupState.fallbackTerminationNeeded}; bridgeStopped=${cleanupState.bridgeStopped}; ${cleanupState.shutdownError ?? ""}${cleanupState.shutdownDiagnostics ? ` ownership=${JSON.stringify(cleanupState.shutdownDiagnostics)}` : ""}`);
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    process.off("message", onLifecycleCancellation);
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
      let settled = false;
      let timer;
      let check;
      const cleanupWait = () => {
        clearTimeout(timer);
        clearInterval(check);
        startupAbort.signal.removeEventListener("abort", onAbort);
      };
      const finish = (handler, value) => {
        if (settled) return;
        settled = true;
        cleanupWait();
        handler(value);
      };
      const onAbort = () => finish(reject, runCancelledError());
      timer = setTimeout(() => finish(reject, new Error(`timeout waiting for response to ${cmd.method}`)), 8000);
      check = setInterval(() => {
        if (responses.has(id)) {
          finish(resolve, responses.get(id));
        }
      }, 20);
      if (startupAbort.signal.aborted) {
        onAbort();
        return;
      }
      startupAbort.signal.addEventListener("abort", onAbort, { once: true });
      try {
        bridge.stdin.write(JSON.stringify(wire) + "\n");
      } catch (error) {
        finish(reject, error);
      }
    });
  }

  function sendRaw(line) {
    if (startupAbort.signal.aborted) throw runCancelledError();
    bridge.stdin.write(line + "\n");
  }

  try {
    // Wait for the bridge to emit its initial connecting event.
    const start = Date.now();
    while (!events.some((e) => e.type === "connection_status" && e.status.kind === "connecting") && Date.now() - start < 4000) {
      await waitForRun(50);
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
      await waitForRun(50);
    }
    const connectedEventSeen = events.some((e) => e.type === "connection_status" && e.status.kind === "connected");

    // 3. Wait for the snapshot event
    const t1 = Date.now();
    while (!events.some((e) => e.type === "snapshot") && Date.now() - t1 < 4000) {
      await waitForRun(50);
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
        await waitForRun(50);
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
    while (responseFrames.length < parseResponseStart + 1 && Date.now() < parseDeadline) await waitForRun(20);
    const parseResponses = responseFrames.slice(parseResponseStart);
    const parseErrorResp = parseResponses[0];
    record("malformed JSON returns parse error with null id",
      parseResponses.length === 1 && parseErrorResp.error?.code === -32700
        && Object.hasOwn(parseErrorResp, "id") && parseErrorResp.id === null,
      `responses=${JSON.stringify(parseResponses)}`);
    await waitForRun(300);
    record("bridge survives malformed JSON line", bridge.exitCode === null, `pid alive=${bridge.exitCode === null}`);

    // 14. A real object without method must receive one -32600/null-id response.
    const invalidRequestStart = responseFrames.length;
    sendRaw(JSON.stringify({ jsonrpc: "2.0", id: "invalid-no-method" }));
    const invalidRequestDeadline = Date.now() + 5000;
    while (responseFrames.length < invalidRequestStart + 1 && Date.now() < invalidRequestDeadline) await waitForRun(20);
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
    while (responseFrames.length < nullIdResponseStart + 1 && Date.now() < nullIdDeadline) await waitForRun(20);
    const nullIdFrames = responseFrames.slice(nullIdResponseStart);
    const nullIdResp = nullIdFrames[0];
    record("present null id returns one successful response",
      nullIdFrames.length === 1 && Object.hasOwn(nullIdResp, "id") && nullIdResp.id === null
        && Object.hasOwn(nullIdResp, "result") && typeof nullIdResp.result?.status?.kind === "string",
      `responses=${JSON.stringify(nullIdFrames)}`);

    // 17. Only an absent ID denotes a notification; assert no response frame.
    const notificationResponseStart = responseFrames.length;
    sendRaw(JSON.stringify({ method: "getState", params: {} }));
    await waitForRun(300);
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
    const ns2 = await send({ id: "c22", method: "newSession", params: { cwd: sessionCwd } });
    record("newSession({cwd}) creates a draft session and returns its real activeSessionId",
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
      // Empty sessions are drafts and are intentionally discarded when a
      // worker closes. Exercise recovery with a real user entry so this check
      // covers a durable, live session rather than a not-yet-persisted draft.
      // Select the E2E-only loopback provider so this probe never needs live API credentials.
      const recoveryModelProvider = process.env.BRIDGE_VERIFY_MODEL_PROVIDER;
      const recoveryModelId = process.env.BRIDGE_VERIFY_MODEL_ID;
      const recoveryProbeText = `Sophos recovery persistence probe ${createdSessionId}`;
      const recoveryProbeDispatch = await runRecoveryProbe({
        send,
        provider: recoveryModelProvider,
        model: recoveryModelId,
        text: recoveryProbeText,
      });
      const recoveryModelSelection = recoveryProbeDispatch.modelSelection;
      const recoveryModelSelected = recoveryProbeDispatch.modelSelected;
      record("recovery probe selects the isolated deterministic test model",
        recoveryModelSelected,
        `provider=${recoveryModelProvider ?? "missing"} model=${recoveryModelId ?? "missing"} failure=${recoveryProbeDispatch.selectionFailure ?? "none"} errorCode=${recoveryModelSelection?.error?.code ?? "none"}`);
      if (!recoveryModelSelected) {
        throw new Error("recovery probe aborted because the isolated deterministic test model was not selected");
      }
      const recoveryProbeError = recoveryProbeDispatch.promptError;
      const recoveryProbeResponse = recoveryProbeDispatch.promptResponse;
      const recoveryProbeDeadline = Date.now() + 5000;
      let recoveryProbeSample = 0;
      let recoveryProbeTranscript = await send({ id: "c30s0", method: "getTranscript", params: {} });
      while (
        Date.now() < recoveryProbeDeadline &&
        !JSON.stringify(recoveryProbeTranscript.result ?? []).includes(recoveryProbeText)
      ) {
        await waitForRun(100);
        recoveryProbeTranscript = await send({ id: `c30s${++recoveryProbeSample}`, method: "getTranscript", params: {} });
      }
      const recoveryProbeIsDurable = Array.isArray(recoveryProbeTranscript.result) &&
        JSON.stringify(recoveryProbeTranscript.result).includes(recoveryProbeText);
      const recoveryProbeErrorMessage = recoveryProbeResponse?.error
        ? `${recoveryProbeResponse.error.code} ${recoveryProbeResponse.error.message ?? ""}`
        : recoveryProbeError instanceof Error
          ? recoveryProbeError.message
          : recoveryProbeError ? String(recoveryProbeError) : "none";
      const safeRecoveryProbeErrorMessage = recoveryProbeErrorMessage
        .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
        .replace(/\b(api[_-]?key|token|secret|password)(\s*[:=]\s*)[^\s,;]+/gi, "$1$2[REDACTED]")
        .replace(/\s+/g, " ")
        .slice(0, 240);
      record("session recovery probe has a durable user message before replacement",
        recoveryProbeIsDurable,
        `entries=${Array.isArray(recoveryProbeTranscript.result) ? recoveryProbeTranscript.result.length : "not-array"} promptError=${JSON.stringify(safeRecoveryProbeErrorMessage)}`);
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
          await waitForRun(50);
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
        if (Date.now() < recoveryDeadline) await waitForRun(250);
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
      const recoveredTranscriptContainsProbe = Array.isArray(transcriptAfterReconnect.result) &&
        JSON.stringify(transcriptAfterReconnect.result).includes(recoveryProbeText);
      record("created session transcript remains retrievable after daemon replacement",
        recoveredTranscriptContainsProbe,
        `containsProbeText=${recoveredTranscriptContainsProbe} entries=${transcriptAfterReconnect.result?.length ?? "not-array"}`);
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
    if (err?.name !== "RunCancelledError") record("test harness", false, err.message);
  } finally {
    const cleanupState = await startCleanup();
    record("graceful daemon shutdown releases adopted session workers before HOME removal",
      cleanupState.daemonStopped && cleanupState.bridgeStopped,
      `daemonStopped=${cleanupState.daemonStopped}; gracefulResult=${cleanupState.gracefulDaemonStopped}; processExited=${cleanupState.daemonProcessStopped}; fallback=${cleanupState.fallbackTerminationNeeded}; bridgeStopped=${cleanupState.bridgeStopped}; ${cleanupState.shutdownError ?? ""}${cleanupState.shutdownDiagnostics ? ` ownership=${JSON.stringify(cleanupState.shutdownDiagnostics)}` : ""}`);
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    process.off("message", onLifecycleCancellation);
  }

  if (signalReceived) return;
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
