// demo-launch.mjs — launch the Sophos release build in DEMO MODE.
//
// Demo mode is a real app feature: when launched with `--demo` (or
// SOPHOS_DEMO_MODE=1), the Rust shell skips the daemon + sidecar and injects
// `window.__SOPHOS_DEMO__ = true`, so the frontend uses the MockIpcClient
// (the same simulated sessions, agents, and messages the browser preview
// uses). This makes the full UI demonstrable and testable via cua-driver
// without a live provider.
//
// This mirrors launch.mjs's launchApp() but passes `additional_arguments:
// ["--demo"]` through cua-driver's launch_app tool (the harness's launchApp
// cannot, and the harness files are off-limits to modification).

import path from "node:path";
import { fileURLToPath } from "node:url";
import { call, getWindowState, click, sleep } from "./driver.mjs";
import { DEFAULT_APP_PATH, waitForWindow } from "./launch.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Enable WebView2 accessibility by clicking once on the web content.
 * Retries on UIA timeout (the provider can be briefly unresponsive right
 * after a launch, especially under multi-instance contention). */
export async function enableWebContentAccessibility(pid, windowId) {
  let state;
  // Retry the initial getWindowState (UIA can be briefly unresponsive).
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      state = getWindowState(pid, windowId, { include_screenshot: false });
      break;
    } catch (err) {
      if (attempt < 4 && /timed out|unresponsive/i.test(err.message)) {
        await sleep(2000);
        continue;
      }
      throw err;
    }
  }
  const sw = state.screenshot_width || 1200;
  const sh = state.screenshot_height || 800;
  click(pid, Math.round(sw / 2), Math.round(sh / 2), windowId);
  await sleep(400);
  // Retry the post-click getWindowState too (same UIA contention risk).
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return getWindowState(pid, windowId, { include_screenshot: false });
    } catch (err) {
      if (attempt < 2 && /timed out|unresponsive/i.test(err.message)) {
        await sleep(2000);
        continue;
      }
      throw err;
    }
  }
}

/**
 * Launch the Sophos release build in demo mode. Returns `{ pid, windowId }`.
 * `appPath` defaults to the release build. Retries on UIA timeout, killing
 * and relaunching the app if the window stays persistently unresponsive.
 */
export async function launchDemoApp(appPath = DEFAULT_APP_PATH) {
  for (let launchAttempt = 0; launchAttempt < 3; launchAttempt++) {
    const res = call("launch_app", { path: appPath, additional_arguments: ["--demo"] });
    const pid = res.pid;
    try {
      const { pid: foundPid, windowId } = await waitForWindow(pid);
      try {
        await enableWebContentAccessibility(foundPid, windowId);
        return { pid: foundPid, windowId };
      } catch (err) {
        if (launchAttempt < 2 && /timed out|unresponsive/i.test(err.message)) {
          // Window is persistently unresponsive — kill it and relaunch.
          try { call("kill_app", { pid: foundPid }); } catch {}
          await sleep(2000);
          continue;
        }
        throw err;
      }
    } catch (err) {
      if (launchAttempt < 2) { await sleep(2000); continue; }
      throw err;
    }
  }
  throw new Error("launchDemoApp: failed after 3 launch attempts");
}
