// run-all.mjs — CI entry point that runs all 7 cua-driver e2e test suites in
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

/** Ordered suites, in the order they must run. */
const SUITES = [
  { file: "smoke.mjs", label: "SMOKE" },
  { file: "sessions.test.mjs", label: "SESSIONS" },
  { file: "agents.test.mjs", label: "AGENTS" },
  { file: "chat.test.mjs", label: "CHAT" },
  { file: "inbox.test.mjs", label: "INBOX" },
  { file: "settings.test.mjs", label: "SETTINGS" },
  { file: "shell.test.mjs", label: "SHELL" },
];

/** Hard per-suite timeout (ms). 5 minutes is generous for 30s–2min suites. */
const SUITE_TIMEOUT_MS = 5 * 60 * 1000;

const thisDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Run one suite as a child process. Resolves with the suite result object.
 * Never rejects — crashes and timeouts are captured as failures.
 */
function runSuiteChild(suite) {
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

    // Hard per-suite timeout: kill the child, then force-resolve shortly after
    // in case the child somehow survives the kill and never emits `close`
    // (belt-and-suspenders so the runner can never hang on a zombie child).
    let settled = false;
    let killedByTimer = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const killTimer = setTimeout(() => {
      killedByTimer = true;
      console.error(`  ! ${suite.label}: exceeded ${SUITE_TIMEOUT_MS / 1000}s timeout; killing`);
      child.kill("SIGKILL");
      // If the child ignores the kill and never emits `close`, force-resolve
      // as a timed-out failure so the runner advances to the next suite.
      setTimeout(() => {
        finish({
          label: suite.label,
          file: suite.file,
          ok: false,
          timedOut: true,
          code: null,
          signal: "SIGKILL",
          reason: `timed out after ${SUITE_TIMEOUT_MS / 1000}s (child did not exit)`,
        });
      }, 5000);
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
      // If our timeout fired, this close is the aftermath of the SIGKILL -
      // label it a timeout regardless of how the platform surfaces the exit
      // (Windows may report a nonzero code with signal=null rather than
      // code=null/signal=SIGKILL). Otherwise, a null code/signal signals a
      // natural abnormal termination.
      const timedOut = killedByTimer || signal !== null || code === null;
      const ok = !timedOut && code === 0;
      finish({
        label: suite.label,
        file: suite.file,
        ok,
        timedOut,
        code,
        signal,
        reason: timedOut
          ? `timed out after ${SUITE_TIMEOUT_MS / 1000}s`
          : code === 0
            ? "exit 0"
            : `exit ${code}`,
      });
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
    console.log(`  [${r.ok ? "PASS" : "FAIL"}] ${r.label.padEnd(10)} ${r.file} (${r.elapsedMs}ms) ${r.timedOut ? "TIMEOUT" : ""}`);
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

main();
