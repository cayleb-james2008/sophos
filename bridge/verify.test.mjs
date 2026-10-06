import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const verifySource = await readFile(new URL("./verify.mjs", import.meta.url), "utf8");

test("supervisor recovery stops only the old supervisor so Windows session workers survive for adoption", () => {
  const recoveryMarker = 'if (process.env.BRIDGE_VERIFY_RECOVERY === "1") {';
  const recoveryStart = verifySource.lastIndexOf(recoveryMarker);
  const recoveryEnd = verifySource.indexOf("const malformedSession", recoveryStart);
  assert.ok(recoveryStart >= 0 && recoveryEnd > recoveryStart, "session recovery block is present");
  const recoveryBlock = verifySource.slice(recoveryStart, recoveryEnd);

  assert.match(
    recoveryBlock,
    /await terminateSupervisorOnly\(oldSupervisorIdentity\)/,
    "the recovery scenario must stop the supervisor PID obtained from the listening socket; process handles can be contenders waiting behind the startup fence",
  );
  assert.doesNotMatch(recoveryBlock, /terminateProcessTree\(oldDaemon\)/);
  assert.ok(recoveryBlock.includes("const oldSupervisorIdentity = await logRecoveryOwnership("));
  assert.ok(recoveryBlock.includes("waitForProcessIdentityExit(oldSupervisorIdentity)"));
  assert.ok(recoveryBlock.includes("const recoveryDeadline = Date.now() + 45_000;"));
  assert.ok(recoveryBlock.includes("waitForSupervisorReplacement(oldSupervisorIdentity, Math.max(0, recoveryDeadline - Date.now()))"));
  assert.ok(recoveryBlock.includes("Date.now() < recoveryDeadline && connectedAfterReplacement()"));
  assert.doesNotMatch(recoveryBlock, /await startDaemon\(\)/, "a second queued start can acquire the socket after the intended supervisor exits");

  const supervisorStopStart = verifySource.indexOf("async function terminateSupervisorOnly(identity) {");
  const supervisorStopEnd = verifySource.indexOf("\n}", supervisorStopStart);
  assert.ok(supervisorStopStart >= 0 && supervisorStopEnd > supervisorStopStart, "process-only supervisor stop helper is defined");
  const supervisorStop = verifySource.slice(supervisorStopStart, supervisorStopEnd);
  assert.match(supervisorStop, /getProcessStartId\(identity\.pid\)/, "termination must re-check the listening supervisor's process identity before signaling its PID");
  assert.match(supervisorStop, /currentStartId !== identity\.processStartId/);
  assert.match(supervisorStop, /execFileSync\("taskkill", \["\/PID", String\(identity\.pid\), "\/F"\]/);
  assert.match(supervisorStop, /process\.kill\(identity\.pid, "SIGTERM"\)/);
  assert.equal(supervisorStop.includes('"/T"'), false, "process-only termination must not target worker descendants");

  const identityExitStart = verifySource.indexOf("async function waitForProcessIdentityExit(identity");
  const identityExitEnd = verifySource.indexOf("\n}", identityExitStart);
  assert.ok(identityExitStart >= 0 && identityExitEnd > identityExitStart, "identity-aware process exit wait is defined");
  const identityExit = verifySource.slice(identityExitStart, identityExitEnd);
  assert.equal(identityExit.includes("getProcessStartId"), false, "Windows process-start queries launch PowerShell; compare once before signaling, then wait on process liveness");
  assert.ok(identityExit.includes("processIsAlive(identity.pid)"));
});

test("bridge reconnect waits for the worker-owned replacement supervisor instead of queuing another daemon", () => {
  const recoveryMarker = 'if (process.env.BRIDGE_VERIFY_RECOVERY === "1") {';
  const start = verifySource.indexOf(recoveryMarker);
  const end = verifySource.indexOf("// 6. getModels", start);
  assert.ok(start >= 0 && end > start, "initial recovery block is present");
  const recoveryBlock = verifySource.slice(start, end);

  assert.ok(recoveryBlock.includes("const oldSupervisorIdentity = await logRecoveryOwnership("));
  assert.match(recoveryBlock, /await terminateSupervisorOnly\(oldSupervisorIdentity\)/);
  assert.ok(recoveryBlock.includes("waitForProcessIdentityExit(oldSupervisorIdentity)"));
  assert.ok(recoveryBlock.includes("waitForSupervisorReplacement(oldSupervisorIdentity)"));
  assert.doesNotMatch(recoveryBlock, /await startDaemon\(\)/, "a queued daemon process can bind after the monitor-owned supervisor shuts down");
});

test("normal verifier cleanup gracefully stops adopted workers before the isolated HOME is removed", () => {
  const cleanupStart = verifySource.indexOf("const cleanup = async () => {");
  const cleanupEnd = verifySource.indexOf("const onSignal", cleanupStart);
  assert.ok(cleanupStart >= 0 && cleanupEnd > cleanupStart, "async normal cleanup is present");
  const cleanupBlock = verifySource.slice(cleanupStart, cleanupEnd);
  assert.ok(cleanupBlock.includes("await shutdownDaemonGracefully()"));
  assert.ok(cleanupBlock.includes("if (!daemonStopped || !daemonProcessStopped)") && cleanupBlock.includes("terminateProcessTree(daemon)"));

  const gracefulStart = verifySource.indexOf("async function shutdownDaemonGracefully() {");
  const gracefulEnd = verifySource.indexOf("\n}", gracefulStart);
  assert.ok(gracefulStart >= 0 && gracefulEnd > gracefulStart, "graceful shutdown helper is present");
  assert.ok(verifySource.slice(gracefulStart, gracefulEnd).includes("shutdownDaemonAndWait(SOCKET_PATH, 10000)"));
  assert.ok(verifySource.includes('record("graceful daemon shutdown releases adopted session workers before HOME removal"'));
});

test("normal cleanup waits for the daemon process to exit after its shutdown socket closes", () => {
  const cleanupStart = verifySource.indexOf("const cleanup = async () => {");
  const cleanupEnd = verifySource.indexOf("const onSignal", cleanupStart);
  const cleanupBlock = verifySource.slice(cleanupStart, cleanupEnd);
  assert.ok(cleanupBlock.includes("let daemonProcessStopped"));
  assert.ok(cleanupBlock.includes("if (!daemonStopped || !daemonProcessStopped)"));
  assert.ok(cleanupBlock.includes("daemonStopped: daemonStopped && daemonProcessStopped"));
  const gracefulCall = cleanupBlock.indexOf("shutdownResult = await shutdownDaemonGracefully()");
  const processExitWait = cleanupBlock.indexOf("daemonProcessStopped = await waitForExit(daemon, 5000)");
  assert.ok(gracefulCall >= 0 && cleanupBlock.includes("daemonStopped = shutdownResult.stopped") && processExitWait > gracefulCall, "wait for child process exit after graceful socket shutdown");
  assert.ok(verifySource.includes("proc.exitCode !== null || proc.signalCode !== null"), "waitForExit recognizes signal termination");
});

test("failed graceful shutdown captures supervisor and adopted-worker ownership before fallback", () => {
  const cleanupStart = verifySource.indexOf("const cleanup = async () => {");
  const cleanupEnd = verifySource.indexOf("const onSignal", cleanupStart);
  const cleanupBlock = verifySource.slice(cleanupStart, cleanupEnd);
  const snapshot = cleanupBlock.indexOf("snapshotShutdownState(");
  const fallback = cleanupBlock.indexOf("terminateProcessTree(daemon)");

  assert.ok(snapshot >= 0 && fallback > snapshot, "process and worker snapshots must be captured before fallback termination");
  assert.ok(cleanupBlock.includes("shutdownError = safeDiagnosticError(error).error"), "error formatting must not bypass the fallback path");
  assert.match(verifySource, /async function inspectSupervisorIdentity\(\)/);
  assert.match(verifySource, /function readWorkerDescriptorPids\(\)/);
  assert.match(verifySource, /function snapshotShutdownState\(/);
});

test("forced fallback cannot convert a failed graceful shutdown into a passing assertion", () => {
  const cleanupStart = verifySource.indexOf("const cleanup = async () => {");
  const cleanupEnd = verifySource.indexOf("const onSignal", cleanupStart);
  const cleanupBlock = verifySource.slice(cleanupStart, cleanupEnd);

  assert.ok(cleanupBlock.includes("let fallbackTerminationNeeded = false"));
  assert.ok(cleanupBlock.includes("fallbackTerminationNeeded = true"));
  assert.ok(cleanupBlock.includes("daemonLauncherHandlePresent: Boolean(daemon)"));
  assert.ok(cleanupBlock.includes("processExitedDerivedFromAbsentHandle: !daemon"));
  assert.ok(cleanupBlock.includes("daemonStopped: daemonStopped && daemonProcessStopped && !fallbackTerminationNeeded"));
});

test("shutdown RPC tracing preserves the original request, response, and thrown error", async () => {
  const { traceShutdownRpc } = await import("./verify-shutdown-diagnostics.mjs");
  const calls = [];
  const shutdownResponse = { success: true, type: "shutdown" };
  const shutdownFailure = new Error("RPC transport closed");
  const client = {
    async request(command, options) {
      calls.push({ command, options });
      if (command.type === "shutdown") {
        if (calls.filter((call) => call.command.type === "shutdown").length === 1) return shutdownResponse;
        throw shutdownFailure;
      }
      return { success: true, type: command.type };
    },
  };
  const trace = [];
  const restore = traceShutdownRpc(client, trace, () => "2026-10-06T00:00:00.000Z");
  try {
    const listCommand = { type: "list" };
    const listOptions = { timeoutMs: 100 };
    assert.deepEqual(await client.request(listCommand, listOptions), { success: true, type: "list" });
    assert.deepEqual(calls[0], { command: listCommand, options: listOptions });
    assert.strictEqual(await client.request({ type: "shutdown" }), shutdownResponse);
    await assert.rejects(client.request({ type: "shutdown" }), (error) => error === shutdownFailure);
  } finally {
    restore();
  }
  assert.deepEqual(trace, [
    { event: "shutdown_rpc_request", at: "2026-10-06T00:00:00.000Z", command: { type: "shutdown" } },
    { event: "shutdown_rpc_response", at: "2026-10-06T00:00:00.000Z", response: shutdownResponse },
    { event: "shutdown_rpc_request", at: "2026-10-06T00:00:00.000Z", command: { type: "shutdown" } },
    { event: "shutdown_rpc_error", at: "2026-10-06T00:00:00.000Z", error: "RPC transport closed", name: "Error", stack: shutdownFailure.stack },
  ]);
});

test("shutdown RPC tracing can observe requests made by clients constructed after instrumentation", async () => {
  const { traceShutdownRpc } = await import("./verify-shutdown-diagnostics.mjs");
  const prototype = {
    async request(command) {
      return { type: command.type, tag: this.tag };
    },
  };
  const trace = [];
  const restore = traceShutdownRpc(prototype, trace, () => "2026-10-06T00:00:00.000Z");
  try {
    const client = Object.assign(Object.create(prototype), { tag: "new-client" });
    assert.deepEqual(await client.request({ type: "shutdown" }), { type: "shutdown", tag: "new-client" });
  } finally {
    restore();
  }
  assert.deepEqual(trace.map((entry) => entry.event), ["shutdown_rpc_request", "shutdown_rpc_response"]);
});

test("shutdown tracing remains fail-open if trace storage rejects writes", async () => {
  const { traceShutdownRpc } = await import("./verify-shutdown-diagnostics.mjs");
  const response = { success: true, type: "shutdown" };
  let calls = 0;
  const client = { async request() { calls += 1; return response; } };
  const restore = traceShutdownRpc(client, Object.freeze([]), () => {
    throw new Error("clock unavailable");
  });
  try {
    assert.strictEqual(await client.request({ type: "shutdown" }), response);
    assert.equal(calls, 1);
  } finally {
    restore();
  }
});

test("error diagnostics cannot replace an unprintable RPC rejection", async () => {
  const { traceShutdownRpc } = await import("./verify-shutdown-diagnostics.mjs");
  const thrown = { toString() { throw new Error("broken error formatter"); } };
  const client = { async request() { throw thrown; } };
  const trace = [];
  const restore = traceShutdownRpc(client, trace, () => "2026-10-06T00:00:00.000Z");
  try {
    await assert.rejects(client.request({ type: "shutdown" }), (error) => error === thrown);
  } finally {
    restore();
  }
  assert.deepEqual(trace[1], {
    event: "shutdown_rpc_error",
    at: "2026-10-06T00:00:00.000Z",
    error: "<unprintable thrown value>",
    name: "unknown",
  });
});
