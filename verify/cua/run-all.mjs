// run-all.mjs — CI entry point that runs all 8 cua-driver e2e test suites in
// sequence and aggregates their exit codes.
//
// Run:  node verify/cua/run-all.mjs    (or: npm run test:cua)
//
// Why child processes: each suite file self-executes at module level (it calls
// runSuite / runDemoSuite and sets process.exitCode on failure). Running each
// in its own child process isolates failures — a crash in one suite cannot
// kill the runner or prevent the remaining suites from running — and gives us
// a clean per-suite exit code plus a hard timeout.
//
// Exit code: 0 if ALL suites pass, 1 if ANY suite fails, times out, or cannot
// be started.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { killLingeringAppInstances, restartDaemon } from "./cleanup.mjs";

/** Ordered suites, in the order they must run. */
const SUITES = [
  { file: "smoke.mjs", label: "SMOKE" },
  { file: "sessions.test.mjs", label: "SESSIONS" },
  { file: "agents.test.mjs", label: "AGENTS" },
  { file: "chat.test.mjs", label: "CHAT" },
  { file: "inbox.test.mjs", label: "INBOX" },
  { file: "settings.test.mjs", label: "SETTINGS" },
  { file: "shell.test.mjs", label: "SHELL" },
  { file: "studio.test.mjs", label: "STUDIO" },
];

/** Hard per-suite timeout (ms). The slowest suites legitimately take ~5 minutes
 * (CHAT ~4.5min, STUDIO ~5min, SHELL's theme retry loop under WebView2 timing
 * flakes can run long), so 10 minutes leaves headroom while still catching a
 * genuinely hung suite. Override with CUA_SUITE_TIMEOUT_MS to exercise the
 * timeout path quickly in a smoke test. */
const SUITE_TIMEOUT_MS = Number(process.env.CUA_SUITE_TIMEOUT_MS) || 10 * 60 * 1000;

const thisDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Run one suite as a child process. Resolves with the suite result object.
 * Never rejects — crashes and timeouts are captured as failures.
 */
export function runSuiteChild(suite) {
  return new Promise((resolve) => {
    const scriptPath = path.join(thisDir, suite.file);
    const child = spawn(process.execPath, [scriptPath], {
      cwd: path.join(thisDir, "..", ".."),
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      process.stdout.write(d);
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      process.stderr.write(d);
      stderr += d;
    });

    // The suite is resolved exactly once, either normally or (after cleanup)
    // on the abnormal paths below. `settled` also gates the `close` handler so
    // a spawn failure (already resolved via `error`) can't trigger a spurious
    // cleanup, and `cleaningUp` makes cleanup idempotent across the timeout
    // and `close` paths firing back-to-back.
    let settled = false;
    let cleaningUp = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const timedOutResult = () => ({
      label: suite.label,
      file: suite.file,
      ok: false,
      timedOut: true,
      code: null,
      signal: "SIGKILL",
      reason: `timed out after ${SUITE_TIMEOUT_MS / 1000}s`,
    });

    // Non-timeout failure result. `code`/`signal` describe HOW it failed:
    // a normal non-zero exit (a test failed after afterAll ran) or a hard
    // termination (signal / null code — a crash that skipped afterAll).
    const failResult = (code, signal) => ({
      label: suite.label,
      file: suite.file,
      ok: false,
      timedOut: false,
      code,
      signal,
      reason:
        signal !== null || code === null ? `abnormal exit (code=${code}, signal=${signal})` : `exit ${code}`,
    });

    const passResult = () => ({
      label: suite.label,
      file: suite.file,
      ok: true,
      timedOut: false,
      code: 0,
      signal: null,
      reason: "exit 0",
    });

    // Tear down after every suite, THEN resolve — so the next suite never
    // starts while the previous one's processes are still being torn down.
    // Even a clean pass leaves WebView2 crashpad-handler processes behind (they
    // outlive the app), and a killed/crashed suite additionally leaves the app
    // + a possibly-degraded daemon; this sweep kills the app + Sophos WebView2
    // and restarts the daemon regardless of outcome. Every sub-step is
    // time-bounded (driver CLI calls, the PowerShell pass, and startDaemon's
    // readiness poll all carry their own timeouts), so this can never hang the
    // runner. Whichever path fires first (timeout or `close`) owns the result;
    // the other becomes a no-op.
    const cleanupAndFinish = async (result) => {
      if (cleaningUp) return;
      cleaningUp = true;
      console.error(`  … ${suite.label}: cleaning up app + WebView2 children, restarting daemon`);
      try {
        await killLingeringAppInstances();
        await restartDaemon();
      } catch (err) {
        console.error(`  ! ${suite.label}: cleanup failed (non-fatal): ${err.message}`);
      }
      finish(result());
    };

    const killTimer = setTimeout(() => {
      console.error(`  ! ${suite.label}: exceeded ${SUITE_TIMEOUT_MS / 1000}s timeout; killing`);
      child.kill("SIGKILL");
      cleanupAndFinish(timedOutResult);
    }, SUITE_TIMEOUT_MS);

    child.on("error", (err) => {
      clearTimeout(killTimer);
      finish({
        label: suite.label,
        file: suite.file,
        ok: false,
        timedOut: false,
        code: null,
        reason: `spawn error: ${err.message}`,
      });
    });

    child.on("close", (code, signal) => {
      clearTimeout(killTimer);
      // A spawn failure already resolved via `error` (Node emits `close` after
      // it, with null code/signal) — nothing ran, so there is nothing to clean.
      if (settled) return;
      // Tear down after EVERY suite, not just failures: a clean `kill_app`
      // still leaves WebView2 crashpad-handler processes behind (they don't
      // self-exit), so a passing suite leaks too. The exit code only sets the
      // pass/fail label — cleanup is unconditional.
      const passed = code === 0;
      if (!cleaningUp && !passed) {
        console.error(`  ! ${suite.label}: ${failResult(code, signal).reason}; cleaning up`);
      }
      cleanupAndFinish(passed ? passResult : () => failResult(code, signal));
    });
  });
}

async function main() {
  const startedAt = Date.now();
  console.log("================================================");
  console.log("  cua-driver e2e — run-all");
  console.log(`  ${SUITES.length} suites, ${SUITE_TIMEOUT_MS / 1000}s timeout each`);
  console.log("================================================");

  const results = [];
  for (const suite of SUITES) {
    const suiteStart = Date.now();
    console.log(`\n>>> Running ${suite.label} (${suite.file}) ...`);
    const result = await runSuiteChild(suite);
    result.elapsedMs = Date.now() - suiteStart;
    results.push(result);
    console.log(
      `<<< ${suite.label}: ${result.ok ? "PASS" : "FAIL"} (${result.reason}, ${result.elapsedMs}ms)`,
    );
  }

  const totalMs = Date.now() - startedAt;
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;

  console.log("\n================================================");
  console.log("  SUMMARY");
  console.log("================================================");
  for (const r of results) {
    console.log(
      `  [${r.ok ? "PASS" : "FAIL"}] ${r.label.padEnd(10)} ${r.file} (${r.elapsedMs}ms) ${r.timedOut ? "TIMEOUT" : ""}`,
    );
  }
  console.log(`\n  ${passed}/${results.length} suites passed, ${failed} failed (${totalMs}ms total)`);

  // Set the exit code and let the process exit naturally so pending async
  // stdout writes flush before termination (process.exit() would truncate
  // the trailing SUMMARY/RUN-ALL lines in a piped/redirected CI stream).
  process.exitCode = failed > 0 ? 1 : 0;
  if (failed > 0) {
    console.log("\nRUN-ALL: FAIL");
  } else {
    console.log("\nRUN-ALL: PASS");
  }
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) main();
