// demo-runner.mjs — test runner for cua-driver e2e tests that launch the app
// in DEMO MODE (MockIpcClient). Mirrors runner.mjs's lifecycle but launches
// with `--demo` so the full Sessions/Agents UI is populated with simulated
// data and testable without a live daemon/provider.
//
// Lifecycle:
//   beforeAll — ensure the cua-driver daemon is running, launch the app in
//               demo mode, expose the app handle ({ pid, windowId }).
//   each test — run the test fn; on failure capture the error.
//   afterAll  — take a final screenshot, close the app, stop the daemon only
//               if this runner started it.

import { startDaemon, stopDaemon, sleep } from "./driver.mjs";
import { closeApp } from "./launch.mjs";
import { takeScreenshot } from "./helpers.mjs";
import { launchDemoApp } from "./demo-launch.mjs";

/** Shared app handle populated by beforeAll. */
export const app = { pid: null, windowId: null };

let daemonStartedByRunner = false;

/** Start the daemon (if needed) and launch the app in demo mode. */
export async function beforeAll() {
  const daemon = startDaemon();
  daemonStartedByRunner = !daemon.alreadyRunning;
  const launched = await launchDemoApp();
  app.pid = launched.pid;
  app.windowId = launched.windowId;
  // Give the MockIpcClient's 600ms connect simulation time to settle.
  await sleep(1200);
  return app;
}

/** Tear down: final screenshot, close the app, stop the daemon if we started it. */
export async function afterAll() {
  if (app.pid) {
    try {
      takeScreenshot(app.pid, "final-state", app.windowId);
    } catch {
      // best-effort
    }
    try {
      closeApp(app.pid);
    } catch {
      // already closed
    }
    app.pid = null;
    app.windowId = null;
  }
  if (daemonStartedByRunner) {
    stopDaemon();
    daemonStartedByRunner = false;
  }
}

/** True when the failure is a torn-down app window (external interference —
 * e.g. another agent relaunching the shared release exe mid-suite). A fresh
 * relaunch + retry is the correct recovery; the test code itself is fine. */
function isStaleWindow(err) {
  return /No window with window_id/i.test(err && err.message ? err.message : "");
}

/** Relaunch the app without touching the daemon (keeps it running across a
 * retry). Retries internally on stale-window tear-downs during launch itself. */
async function relaunchApp() {
  for (let attempt = 1; ; attempt++) {
    if (app.pid) {
      try {
        closeApp(app.pid);
      } catch {
        // window already gone
      }
      app.pid = null;
      app.windowId = null;
    }
    try {
      const launched = await launchDemoApp();
      app.pid = launched.pid;
      app.windowId = launched.windowId;
      await sleep(1200);
      return;
    } catch (err) {
      if (isStaleWindow(err) && attempt < 4) continue;
      throw err;
    }
  }
}

/** Run a single test, retrying up to 3 times on a stale-window tear-down. */
export async function runTest(name, fn) {
  const start = Date.now();
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (!app.pid) await beforeAll();
      await fn(app);
      const elapsed = Date.now() - start;
      console.log(`  \u2713 ${name} (${elapsed}ms)`);
      return { name, pass: true, elapsed };
    } catch (err) {
      if (isStaleWindow(err) && attempt < maxAttempts) {
        console.log(`  ~ ${name}: stale window torn down externally; relaunching + retrying`);
        await relaunchApp();
        continue;
      }
      const elapsed = Date.now() - start;
      console.error(`  \u2717 ${name} (${elapsed}ms): ${err.message}`);
      return { name, pass: false, elapsed, error: err.message };
    }
  }
}

/** Run a suite of tests in demo mode. Sets process.exitCode = 1 on failure. */
export async function runDemoSuite(name, tests) {
  console.log(`\n=== ${name} ===`);
  // Retry the initial launch if the window is torn down externally before it
  // settles (e.g. another agent relaunching the shared release exe).
  for (let attempt = 1; ; attempt++) {
    try {
      await beforeAll();
      break;
    } catch (err) {
      if (isStaleWindow(err) && attempt < 3) {
        console.log(`  ~ initial launch torn down externally; relaunching (attempt ${attempt})`);
        continue;
      }
      throw err;
    }
  }
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
