import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const verifySource = await readFile(new URL("./verify.mjs", import.meta.url), "utf8");
const lifecycleSource = await readFile(new URL("./verify-lifecycle.mjs", import.meta.url), "utf8");

test("cross-platform lifecycle IPC cancellation routes to the verifier's awaited cleanup handler", () => {
  assert.ok(lifecycleSource.includes('stdio: ["inherit", "inherit", "inherit", "ipc"]'));
  assert.ok(lifecycleSource.includes("requestLifecycleCancellation(activeChild, signal)"));
  assert.ok(verifySource.includes('process.on("message", onLifecycleCancellation)'));
  assert.ok(verifySource.includes("if (isLifecycleCancellationMessage(message)) onSignal()"));
  const signalStart = verifySource.indexOf("const onSignal = () => {");
  const signalEnd = verifySource.indexOf('process.on("SIGINT", onSignal)', signalStart);
  const signalHandler = verifySource.slice(signalStart, signalEnd);
  assert.match(signalHandler, /await startCleanup\(\)/);
  assert.match(signalHandler, /await forceCleanup\(\)/);
});

test("recovery probe requires successful isolated model selection before dispatching its prompt", () => {
  const recoveryMarker = 'if (process.env.BRIDGE_VERIFY_RECOVERY === "1") {';
  const recoveryStart = verifySource.lastIndexOf(recoveryMarker);
  const recoveryEnd = verifySource.indexOf("const malformedSession", recoveryStart);
  assert.ok(recoveryStart >= 0 && recoveryEnd > recoveryStart, "session recovery block is present");
  const recoveryBlock = verifySource.slice(recoveryStart, recoveryEnd);
  assert.ok(recoveryBlock.includes("runRecoveryProbe({"));
  assert.ok(recoveryBlock.includes("JSON.stringify(transcriptAfterReconnect.result).includes(recoveryProbeText)"),
    "post-replacement transcript verification must confirm the durable probe text, not just an array response");
  assert.ok(recoveryBlock.includes("if (!recoveryModelSelected)"),
    "failed or missing fixture model selection must skip transcript prompting and supervisor replacement");
  assert.ok(recoveryBlock.includes("BRIDGE_VERIFY_MODEL_PROVIDER"));
  assert.ok(recoveryBlock.includes("BRIDGE_VERIFY_MODEL_ID"));
});

test("standalone lifecycle verifier provisions only the loopback recovery fixture", () => {
  assert.ok(lifecycleSource.includes("startE2EMockProvider()"));
  assert.ok(lifecycleSource.includes("writeE2EMockProviderConfig(isolatedHome, mockProvider.baseUrl)"));
  assert.ok(lifecycleSource.includes("BRIDGE_VERIFY_MODEL_PROVIDER: E2E_MOCK_PROVIDER_ID"));
  assert.ok(lifecycleSource.includes("BRIDGE_VERIFY_MODEL_ID: E2E_MOCK_MODEL_ID"));
  assert.ok(lifecycleSource.includes('PI_OFFLINE: "1"'));
  assert.ok(lifecycleSource.includes("preserved isolated lifecycle HOME for diagnostics"));
  assert.ok(lifecycleSource.includes("cwd: isolatedHome"));
  assert.doesNotMatch(lifecycleSource, /BRIDGE_VERIFY_SOCKET:.*tcp:\/\//);
  assert.ok(lifecycleSource.includes("...isolatedEnv"));
  assert.doesNotMatch(lifecycleSource, /\.\.\.process\.env/);
  assert.ok(lifecycleSource.includes("await mockProvider?.close()"));
});

test("recovery fixture creates a draft session without starting a background goal loop", () => {
  const creationStart = verifySource.indexOf('const ns2 = await send({ id: "c22"');
  const creationEnd = verifySource.indexOf("const createdSessionId =", creationStart);
  assert.ok(creationStart >= 0 && creationEnd > creationStart, "recovery session creation is present");
  const creationBlock = verifySource.slice(creationStart, creationEnd);
  assert.doesNotMatch(creationBlock, /goal:/,
    "the deterministic recovery probe should create a draft and make only its explicit user prompt, not an unbounded model-driven goal loop");
});

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
  assert.ok(recoveryBlock.includes("recoveryProbeResponse.error.message"), "recovery probe failures retain the daemon error detail for diagnosis");
  assert.ok(recoveryBlock.includes("Bearer [REDACTED]"), "recovery probe diagnostics redact credential-shaped error text");
  const probeStart = recoveryBlock.indexOf("const recoveryProbeText =");
  const supervisorTermination = recoveryBlock.indexOf("await terminateSupervisorOnly(oldSupervisorIdentity)");
  assert.ok(probeStart >= 0 && probeStart < supervisorTermination,
    "session recovery must exercise a non-draft user message before the supervisor replacement");
  assert.ok(recoveryBlock.includes('record("session recovery probe has a durable user message before replacement"'));
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

test("signal cleanup awaits the same owned-process shutdown path as normal cleanup", () => {
  const signalStart = verifySource.indexOf("const onSignal = () => {");
  const signalEnd = verifySource.indexOf('process.on("SIGINT", onSignal)', signalStart);
  assert.ok(signalStart >= 0 && signalEnd > signalStart, "signal handler is present");
  const signalBlock = verifySource.slice(signalStart, signalEnd);
  assert.match(signalBlock, /startCleanup\(\)/, "signal handling must await the shared graceful shutdown promise");
  assert.match(signalBlock, /await forceCleanup\(\)/, "failed or repeated signal cleanup must stop verified socket/worker-owned processes");
  assert.match(signalBlock, /process\.exit\(130\)/, "the interrupted verifier exits only after cleanup settles");

  const forceStart = verifySource.indexOf("const forceCleanup = async () => {");
  const forceEnd = verifySource.indexOf("async function shutdownDaemonGracefully", forceStart);
  assert.ok(forceStart >= 0 && forceEnd > forceStart, "identity-aware forced cleanup helper is defined");
  const forceBlock = verifySource.slice(forceStart, forceEnd);
  assert.ok(forceBlock.includes("snapshotShutdownState(daemon"));
  assert.ok(forceBlock.includes("await terminateShutdownOwnedProcesses(snapshot)"));
  assert.ok(forceBlock.includes("await waitForOwnedShutdownProcesses(undefined"));
});

test("shutdown aborts daemon startup and gates bridge/test startup", () => {
  const startupStart = verifySource.indexOf("const startupCompleted = await startBridgeAfterDaemonStartup({");
  const startupEnd = verifySource.indexOf("} catch (err) {", startupStart);
  assert.ok(startupStart >= 0 && startupEnd > startupStart, "daemon and bridge startup are guarded as one lifecycle");
  const startupBlock = verifySource.slice(startupStart, startupEnd);
  assert.ok(startupBlock.includes("startupAbort.signal"), "the daemon startup wait receives the cancellation signal");
  assert.match(startupBlock, /startBridge:\s*\(\) =>/);
  assert.match(startupBlock, /if \(!startupCompleted \|\| startupAbort\.signal\.aborted\)/);
  assert.match(startupBlock, /await startCleanup\(\);\s*return;/);
  assert.ok(verifySource.includes("startupAbort.abort()"), "starting cleanup cancels startup and in-flight test waits");
  assert.ok(verifySource.includes('if (err?.name !== "RunCancelledError")'), "signal cancellation is not recorded as a test failure");
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
  const gracefulBlock = verifySource.slice(gracefulStart, gracefulEnd);
  assert.ok(gracefulBlock.includes("shutdownConnectedDaemonAndWait(client, SOCKET_PATH, 45000, hello)"));
  assert.ok(gracefulBlock.includes("shutdownDaemonAndWait(SOCKET_PATH, 45000)"));
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
  assert.match(verifySource, /function readWorkerDescriptorPids\(socketPath = SOCKET_PATH\)/);
  assert.match(verifySource, /function snapshotShutdownState\(/);
});

test("shutdown fallback targets the current socket owner and only its verified session workers", () => {
  const cleanupStart = verifySource.indexOf("const cleanup = async () => {");
  const cleanupEnd = verifySource.indexOf("const onSignal", cleanupStart);
  const cleanupBlock = verifySource.slice(cleanupStart, cleanupEnd);
  const ownershipCleanup = cleanupBlock.indexOf("await terminateShutdownOwnedProcesses(shutdownDiagnostics)");
  const launcherFallback = cleanupBlock.indexOf("terminateProcessTree(daemon)");

  assert.ok(ownershipCleanup >= 0 && ownershipCleanup < launcherFallback,
    "fallback must terminate socket/descriptor-owned processes before relying on the original launcher handle");
  assert.match(verifySource, /function readWorkerDescriptorPids\(socketPath = SOCKET_PATH\)/);
  assert.match(verifySource, /descriptor\.supervisorSocketPath === socketPath/,
    "worker cleanup must not touch another daemon's descriptors under a non-isolated HOME");
  assert.match(verifySource, /typeof descriptor\.processStartId === \"string\"/);
  assert.match(verifySource, /async function terminateProcessIdentityTree\(identity\)/);
  assert.match(verifySource, /currentStartId !== identity\.processStartId/,
    "fallback must verify a process-start identity before signaling a descriptor PID");
  assert.match(verifySource, /\[\"\/PID\", String\(identity\.pid\), \"\/T\", \"\/F\"\]/,
    "verified process-tree cleanup must stop the session worker's owned descendants too");
});

test("forced fallback cannot convert a failed graceful shutdown into a passing assertion", () => {
  const cleanupStart = verifySource.indexOf("const cleanup = async () => {");
  const cleanupEnd = verifySource.indexOf("const onSignal", cleanupStart);
  const cleanupBlock = verifySource.slice(cleanupStart, cleanupEnd);

  assert.ok(cleanupBlock.includes("let fallbackTerminationNeeded = false"));
  assert.ok(cleanupBlock.includes("fallbackTerminationNeeded = true"));
  assert.ok(cleanupBlock.includes("daemonStopped: daemonStopped && daemonProcessStopped && !fallbackTerminationNeeded"));
  assert.match(cleanupBlock, /shutdownError = error instanceof Error \? error\.message : String\(error\);\s*daemonProcessStopped = false;/);
});
