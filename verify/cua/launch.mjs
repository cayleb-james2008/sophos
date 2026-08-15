// launch.mjs — launch, find, close and restart the Sophos desktop app.
//
// The app is a Tauri v2 desktop app (Rust shell + Node bridge + React
// frontend). Its window title is "Sophos" and its process is
// `prime-agent-windows.exe`.
//
// WebView2 accessibility quirk: on a fresh launch the web content is exposed
// to UIA as a single opaque "Web content" pane. The first interaction with the
// web content (a background click) flips WebView2 into accessibility mode,
// after which the full DOM is exposed as individual UIA elements (buttons,
// text, inputs, …). `launchApp` performs that enabling click automatically so
// callers can rely on the DOM being readable.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { call, listWindows, getWindowState, click, sleep } from "./driver.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Workspace root (two levels up from verify/cua/). */
export const WORKSPACE_ROOT = path.resolve(__dirname, "..", "..");

/** Default path to the Sophos desktop app release build. */
export const DEFAULT_APP_PATH = path.join(
  WORKSPACE_ROOT,
  "src-tauri",
  "target",
  "release",
  "prime-agent-windows.exe",
);

/** The app's process name (from list_windows `app_name`). */
export const APP_PROCESS_NAME = "prime-agent-windows.exe";

/** The app's window title. */
export const APP_WINDOW_TITLE = "Sophos";

/**
 * Find the Sophos desktop app window via cua-driver's list_windows.
 * Matches by process name or exact window title so the browser-hosted
 * "Sophos … - Google Chrome" window is never mistaken for the desktop app.
 * Returns `{ pid, windowId }` or null when not found.
 */
export function findSophosWindow() {
  const windows = listWindows();
  const win = windows.find(
    (w) =>
      (w.app_name && w.app_name.toLowerCase() === APP_PROCESS_NAME) ||
      w.title === APP_WINDOW_TITLE,
  );
  if (!win) return null;
  return { pid: win.pid, windowId: win.window_id };
}

/**
 * Wait (polling list_windows) for a window owned by `pid` to appear.
 * Returns `{ pid, windowId }` or throws after `timeoutMs`.
 */
export async function waitForWindow(pid, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const windows = listWindows({ pid });
    const win = windows.find((w) => w.pid === pid);
    if (win) return { pid, windowId: win.window_id };
    await sleep(300);
  }
  throw new Error(`Timed out waiting for a window owned by pid ${pid}`);
}

/**
 * Enable WebView2 accessibility by clicking once on the web content. On a
 * fresh launch the DOM is a single opaque pane; one background click flips the
 * webview into accessibility mode so the full DOM becomes readable via UIA.
 * The click targets the centre of the window's content area (empty chat
 * surface), which is inert.
 */
export async function enableWebContentAccessibility(pid, windowId) {
  const state = getWindowState(pid, windowId, { include_screenshot: false });
  const sw = state.screenshot_width || 1200;
  const sh = state.screenshot_height || 800;
  // Click near the centre of the content area.
  click(pid, Math.round(sw / 2), Math.round(sh / 2), windowId);
  await sleep(400);
  return getWindowState(pid, windowId, { include_screenshot: false });
}

/**
 * Launch the Sophos desktop app. Waits for its window to appear, enables
 * WebView2 accessibility, and returns `{ pid, windowId }`.
 */
export async function launchApp(appPath = DEFAULT_APP_PATH) {
  const res = call("launch_app", { path: appPath });
  const pid = res.pid;
  const { pid: foundPid, windowId } = await waitForWindow(pid);
  await enableWebContentAccessibility(foundPid, windowId);
  return { pid: foundPid, windowId };
}

/**
 * Close the app by force-terminating its process (equivalent to
 * `taskkill /F /PID <pid>`). Unsaved state is lost.
 */
export function closeApp(pid) {
  return call("kill_app", { pid });
}

/**
 * Close the app (if running) and relaunch it. Returns the new
 * `{ pid, windowId }`.
 */
export async function restartApp(appPath = DEFAULT_APP_PATH) {
  const current = findSophosWindow();
  if (current) {
    try {
      closeApp(current.pid);
    } catch {
      // Already gone — ignore.
    }
    await sleep(1200);
  }
  return launchApp(appPath);
}
