// runner.mjs — minimal test runner for cua-driver e2e tests.
//
// Lifecycle:
//   beforeAll  — ensure the cua-driver daemon is running, launch the app,
//                and expose the app handle ({ pid, windowId }) to tests.
//   each test  — run the test fn; on failure capture the error.
//   afterAll   — take a final screenshot, close the app, and stop the daemon
//                only if this runner started it.
//
// A suite is an array of `{ name, fn }` where `fn` receives the app handle.
// `runSuite` returns a structured result object and sets the process exit code
// to 1 when any test fails, so it can be driven from CI / npm scripts.

import { startDaemon, stopDaemon, sleep } from "./driver.mjs";
import { launchApp, closeApp } from "./launch.mjs";
import { takeScreenshot } from "./helpers.mjs";

/** Shared app handle populated by beforeAll. */
export const app = { pid: null, windowId: null };

let daemonStartedByRunner = false;

/**
 * Start the daemon (if needed) and launch the app. Populates the shared `app`
 * handle. Safe to call once per process.
 */
export async function beforeAll() {
  const daemon = startDaemon();
  daemonStartedByRunner = !daemon.alreadyRunning;
  const launched = await launchApp();
  app.pid = launched.pid;
  app.windowId = launched.windowId;
  return app;
}

/**
 * Tear down: capture a final screenshot, close the app, and stop the daemon
 * only if this runner started it (never kill a pre-existing daemon).
 */
export async function afterAll() {
  if (app.pid) {
    try {
      takeScreenshot(app.pid, "final-state", app.windowId);
    } catch {
      // Screenshot is best-effort.
    }
    try {
      closeApp(app.pid);
    } catch {
      // Already closed.
    }
    app.pid = null;
    app.windowId = null;
  }
  if (daemonStartedByRunner) {
    stopDaemon();
    daemonStartedByRunner = false;
  }
}

/**
 * Run a single test with before/after hooks. The before hook ensures the app
 * is launched and the daemon is running; the after hook captures a screenshot
 * of the final state. Returns `{ name, pass, elapsed, error? }`.
 */
export async function runTest(name, fn) {
  const start = Date.now();
  try {
    if (!app.pid) await beforeAll();
    await fn(app);
    const elapsed = Date.now() - start;
    console.log(`  \u2713 ${name} (${elapsed}ms)`);
    return { name, pass: true, elapsed };
  } catch (err) {
    const elapsed = Date.now() - start;
    console.error(`  \u2717 ${name} (${elapsed}ms): ${err.message}`);
    return { name, pass: false, elapsed, error: err.message };
  }
}

/**
 * Run a suite of tests. `tests` is an array of `{ name, fn }`. Runs beforeAll
 * once, each test, then afterAll. Returns a structured result and sets
 * `process.exitCode` to 1 when any test fails.
 */
export async function runSuite(name, tests) {
  console.log(`\n=== ${name} ===`);
  await beforeAll();
  const results = [];
  for (const test of tests) {
    results.push(await runTest(test.name, test.fn));
  }
  await afterAll();

  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  const totalMs = results.reduce((sum, r) => sum + r.elapsed, 0);
  console.log(`\n${name}: ${passed} passed, ${failed} failed (${totalMs}ms total)`);

  const outcome = { name, results, passed, failed, totalMs };
  if (failed > 0) process.exitCode = 1;
  return outcome;
}

/** Convenience: run a single named test as a one-test suite. */
export async function runSingle(name, fn) {
  return runSuite(name, [{ name, fn }]);
}
