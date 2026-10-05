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
  assert.ok(recoveryBlock.includes("waitForSupervisorReplacement(oldSupervisorIdentity)"));
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
  assert.ok(cleanupBlock.includes("daemonStopped: daemonStopped && daemonProcessStopped && !fallbackTerminationNeeded"));
});
