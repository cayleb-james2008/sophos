// cleanup.mjs — shared process teardown for the cua-driver suite runner.
//
// A suite killed by the runner's hard timeout (SIGKILL) never runs its own
// afterAll(), so it leaves behind the Sophos app (prime-agent-windows.exe)
// and its WebView2 children (msedgewebview2.exe), plus a possibly-degraded
// cua-driver daemon. These helpers tear that down so the next suite starts
// from a clean slate instead of contending with orphaned windows/UIA state.

import { execSync } from "node:child_process";
import { call, listWindows, startDaemon, stopDaemon, sleep } from "./driver.mjs";

/**
 * Kill every running Sophos app instance plus every Sophos WebView2 process.
 * WebView2 is matched by the Tauri identifier (`com.sophos.app`) in its
 * command line, not by parent chain, so other apps' WebView2 are left alone
 * while detached survivors (crashpad-handler, orphaned renderers) are still
 * caught after the app process has already died. Best-effort — never throws.
 */
export async function killLingeringAppInstances() {
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
    // The daemon may not be running (list_windows fails) — nothing to kill via
    // UIA. The PowerShell pass below still kills any app + WebView2 processes
    // directly, so this is never a hard failure.
  }
  await sleep(1500);
  try {
    // Force sweep by identity: kill every Sophos app process and every Sophos
    // WebView2 process (matched on the Tauri identifier in its command line).
    // Matching `com.sophos.app` — rather than walking the parent chain — is
    // what reaches crashpad-handler / detached WebView2 that outlive the app's
    // death (an ancestor walk misses them once their parent PID is gone).
    const ps = [
      "$targets = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {",
      "  $_.Name -eq 'prime-agent-windows.exe' -or",
      "  ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -like '*com.sophos.app*')",
      "};",
      "foreach ($p in $targets) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }",
    ].join(" ");
    execSync(`powershell -NoProfile -Command "${ps}"`, { timeout: 30000 });
  } catch {
    // Best-effort.
  }
  await sleep(2000);
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
