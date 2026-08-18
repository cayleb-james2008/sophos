// cleanup.mjs — shared process teardown for the cua-driver suite runner.
//
// A suite killed by the runner's hard timeout (SIGKILL) never runs its own
// afterAll(), so it leaves behind the Sophos app (prime-agent-windows.exe)
// and its WebView2 children (msedgewebview2.exe), plus a possibly-degraded
// cua-driver daemon. These helpers tear that down so the next suite starts
// from a clean slate instead of contending with orphaned windows/UIA state.

import { execSync, spawnSync } from "node:child_process";
import { call, listWindows, startDaemon, stopDaemon, sleep, DRIVER_BIN } from "./driver.mjs";

/**
 * Snapshot every Sophos process currently running: the app
 * (`prime-agent-windows.exe`) and its WebView2 children (`msedgewebview2.exe`
 * whose command line carries the Tauri identifier `com.sophos.app`). Matching
 * by identity rather than parent chain is what reaches detached survivors
 * (crashpad-handler, orphaned renderers) after the app's parent PID is gone,
 * and it leaves every other app's WebView2 alone. Returns
 * `{ apps: [pid], webviews: [pid] }`.
 */
function listSophosProcesses() {
  const ps = [
    "$ps = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {",
    "  $_.Name -eq 'prime-agent-windows.exe' -or",
    "  ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -like '*com.sophos.app*')",
    "};",
    "$ps | ForEach-Object { $_.ProcessId.ToString() + '|' + $_.Name }",
  ].join(" ");
  try {
    const out = execSync(`powershell -NoProfile -Command "${ps}"`, {
      timeout: 30000,
      encoding: "utf8",
    });
    const apps = [];
    const webviews = [];
    for (const line of out.split(/\r?\n/)) {
      const [pid, name] = line.trim().split("|");
      if (!pid) continue;
      if (name === "prime-agent-windows.exe") apps.push(Number(pid));
      else if (name === "msedgewebview2.exe") webviews.push(Number(pid));
    }
    return { apps, webviews };
  } catch {
    return { apps: [], webviews: [] };
  }
}

/**
 * Kill every running Sophos app instance plus every Sophos WebView2 process.
 * WebView2 is matched by the Tauri identifier (`com.sophos.app`) in its
 * command line, not by parent chain, so other apps' WebView2 are left alone
 * while detached survivors (crashpad-handler, orphaned renderers) are still
 * caught after the app process has already died.
 *
 * The sweep is repeated until nothing Sophos remains: a single snapshot can
 * miss a straggler that finishes spawning between the snapshot and the kill
 * (especially under CI contention). Processes that cannot be stopped (an
 * elevated/higher-integrity instance — Stop-Process yields access denied) are
 * recorded and reported rather than silently swallowed, so drift is always
 * visible. Best-effort — never throws.
 *
 * Returns `{ remaining, unkillable }` for the caller's drift report.
 */
export async function killLingeringAppInstances() {
  // Graceful pass through the driver's UIA layer: kill any Sophos window the
  // daemon knows about (the same call the suites use). Best-effort — if the
  // daemon is down, list_windows fails and the identity sweep below is still
  // sufficient on its own.
  try {
    for (const w of listWindows()) {
      if (w.app_name && w.app_name.toLowerCase().includes("prime-agent")) {
        try {
          call("kill_app", { pid: w.pid });
        } catch {
          // Already gone — ignore.
        }
      }
    }
  } catch {
    // Daemon may not be running — the PowerShell pass below still kills any
    // app + WebView2 processes directly, so this is never a hard failure.
  }
  await sleep(1500);

  const unkillable = new Set();
  for (let pass = 0; pass < 3; pass++) {
    const { apps, webviews } = listSophosProcesses();
    if (apps.length === 0 && webviews.length === 0) break;
    const ps = [
      "$targets = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {",
      "  $_.Name -eq 'prime-agent-windows.exe' -or",
      "  ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -like '*com.sophos.app*')",
      "};",
      "foreach ($p in $targets) {",
      "  try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop }",
      "  catch { Write-Output ('UNKILLABLE|' + $p.ProcessId + '|' + $p.Name) }",
      "}",
    ].join(" ");
    try {
      const out = execSync(`powershell -NoProfile -Command "${ps}"`, {
        timeout: 30000,
        encoding: "utf8",
      });
      for (const line of out.split(/\r?\n/)) {
        const [tag, pid] = line.trim().split("|");
        if (tag === "UNKILLABLE" && pid) unkillable.add(Number(pid));
      }
    } catch {
      // Best-effort — fall through to the re-snapshot.
    }
    await sleep(1200);
  }

  const { apps, webviews } = listSophosProcesses();
  const remaining = apps.length + webviews.length;
  if (unkillable.size > 0) {
    const why = unkillable.size === remaining ? " (access denied — elevated instance)" : "";
    console.warn(
      `  ! cleanup: ${unkillable.size} Sophos process(es) could not be stopped${why}; ` +
        `pids ${[...unkillable].join(", ")} — reported in the drift line, not silently dropped`,
    );
  }
  return { remaining, unkillable: [...unkillable] };
}

/**
 * Restart the cua-driver daemon: stop it (if running) and start a fresh one.
 * A suite killed mid-run can leave the daemon's UIA provider in a degraded
 * state, so a fresh daemon is the reliable recovery. The next suite's
 * startDaemon() detects the fresh daemon and leaves it untouched.
 */
export async function restartDaemon() {
  stopDaemon();
  // Give the old daemon a moment to release its named pipe before the fresh
  // spawn (startDaemon polls for readiness but does not retry the spawn).
  await sleep(1000);
  return startDaemon();
}

/**
 * Snapshot counts for the final drift report: how many Sophos app / WebView2
 * processes remain and whether the cua-driver daemon is still running.
 * Returns `{ apps, webviews, daemonRunning }`.
 */
export function checkDrift() {
  const { apps, webviews } = listSophosProcesses();
  let daemonRunning = false;
  try {
    const s = spawnSync(DRIVER_BIN, ["status"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 30000,
    });
    daemonRunning = /daemon is running/i.test(s.stdout || "");
  } catch {
    // Assume stopped.
  }
  return { apps: apps.length, webviews: webviews.length, daemonRunning };
}
