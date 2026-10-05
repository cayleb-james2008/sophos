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
    /terminateSupervisorOnly\(oldDaemon\)/,
    "the recovery scenario must stop only the daemon process; taskkill /T also kills non-detached Windows workers under test",
  );
  assert.doesNotMatch(recoveryBlock, /terminateProcessTree\(oldDaemon\)/);

  const supervisorStopStart = verifySource.indexOf("function terminateSupervisorOnly(proc) {");
  const supervisorStopEnd = verifySource.indexOf("\n}", supervisorStopStart);
  assert.ok(supervisorStopStart >= 0 && supervisorStopEnd > supervisorStopStart, "process-only supervisor stop helper is defined");
  const supervisorStop = verifySource.slice(supervisorStopStart, supervisorStopEnd);
  assert.match(supervisorStop, /execFileSync\("taskkill", \["\/PID", String\(proc\.pid\), "\/F"\]/);
  assert.equal(supervisorStop.includes('"/T"'), false, "process-only termination must not target worker descendants");
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
  const gracefulCall = cleanupBlock.indexOf("daemonStopped = await shutdownDaemonGracefully()");
  const processExitWait = cleanupBlock.indexOf("daemonProcessStopped = await waitForExit(daemon, 5000)");
  assert.ok(gracefulCall >= 0 && processExitWait > gracefulCall, "wait for child process exit after graceful socket shutdown");
  assert.ok(verifySource.includes("proc.exitCode !== null || proc.signalCode !== null"), "waitForExit recognizes signal termination");
});
