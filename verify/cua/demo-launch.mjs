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

/** Enable WebView2 accessibility by clicking once on the web content. */
export async function enableWebContentAccessibility(pid, windowId) {
  const state = getWindowState(pid, windowId, { include_screenshot: false });
  const sw = state.screenshot_width || 1200;
  const sh = state.screenshot_height || 800;
  click(pid, Math.round(sw / 2), Math.round(sh / 2), windowId);
  await sleep(400);
  return getWindowState(pid, windowId, { include_screenshot: false });
}

/**
 * Launch the Sophos release build in demo mode. Returns `{ pid, windowId }`.
 * `appPath` defaults to the release build.
 */
export async function launchDemoApp(appPath = DEFAULT_APP_PATH) {
  const res = call("launch_app", { path: appPath, additional_arguments: ["--demo"] });
  const pid = res.pid;
  const { pid: foundPid, windowId } = await waitForWindow(pid);
  await enableWebContentAccessibility(foundPid, windowId);
  return { pid: foundPid, windowId };
}
