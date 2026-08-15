// driver.mjs — thin wrapper around the cua-driver CLI binary.
//
// Every function shells out to `cua-driver call <tool>` and returns the parsed
// JSON result. JSON arguments are piped via stdin (not passed as a positional
// arg) because cmd.exe / PowerShell 5.1 strip the double quotes around JSON
// field names, which corrupts multi-field payloads.
//
// The cua-driver works in the background: it does NOT steal the cursor or
// keyboard focus. Pixel clicks route through UIA hit-testing first and only
// fall back to PostMessage when the target has no accessibility peer.
//
// Coordinate note: element `frame` values returned by `get_window_state` are
// in SCREEN coordinates, while `click(x, y)` expects WINDOW-LOCAL pixels
// (top-left of the window's content screenshot). Use `toWindowLocal()` from
// helpers.mjs to convert before a pixel click. Prefer `element_token` clicks
// (UIA Invoke) whenever the element exposes one — they need no coordinates.

import { spawnSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";

/** Path to the cua-driver binary. Override with the CUA_DRIVER_BIN env var. */
export const DRIVER_BIN =
  process.env.CUA_DRIVER_BIN ||
  "C:/Users/Cayleb/AppData/Local/Programs/Cua/cua-driver/bin/cua-driver.exe";

/** Small sleep helper (ms). */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Invoke a cua-driver tool with a JSON payload piped via stdin.
 * Returns the parsed JSON result. Throws on non-zero exit or a plain-text
 * error payload (the driver reports some failures as text, not JSON).
 */
export function call(tool, args = {}) {
  const result = spawnSync(DRIVER_BIN, ["call", tool], {
    input: JSON.stringify(args),
    encoding: "utf-8",
    windowsHide: true,
  });

  if (result.error) {
    throw new Error(`cua-driver call ${tool} failed to spawn: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `cua-driver call ${tool} exited ${result.status}: ${(result.stderr || result.stdout).trim()}`,
    );
  }

  const out = result.stdout.trim();
  if (!out) {
    throw new Error(`cua-driver call ${tool} returned empty output`);
  }

  // Some failures come back as plain text (e.g. "No window with window_id …").
  let parsed;
  try {
    parsed = JSON.parse(out);
  } catch {
    throw new Error(`cua-driver call ${tool} error: ${out}`);
  }

  if (parsed && parsed.isError) {
    throw new Error(`cua-driver call ${tool} error: ${parsed.error || JSON.stringify(parsed)}`);
  }
  return parsed;
}

/**
 * Run a tool, and if the driver reports `background_unavailable` (the target
 * surface drops background input — typical for Tauri/Chromium hotkeys and
 * scroll), retry once with `delivery_mode: "foreground"`. This mirrors the
 * driver's own guidance: always try background first, escalate only on the
 * structured signal.
 */
export function callWithForegroundFallback(tool, args = {}) {
  const first = call(tool, args);
  if (first && first.code === "background_unavailable") {
    return call(tool, { ...args, delivery_mode: "foreground" });
  }
  return first;
}

// ---------------------------------------------------------------------------
// Daemon lifecycle
// ---------------------------------------------------------------------------

/**
 * Ensure the cua-driver daemon is running. Idempotent — if a daemon is already
 * up it is left untouched. Returns `{ alreadyRunning }`.
 */
export function startDaemon() {
  const status = spawnSync(DRIVER_BIN, ["status"], { encoding: "utf-8", windowsHide: true });
  if (status.stdout && /daemon is running/i.test(status.stdout)) {
    return { alreadyRunning: true };
  }

  const child = spawn(DRIVER_BIN, ["serve", "--permission-mode", "standard"], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();

  // Poll until the daemon answers.
  for (let i = 0; i < 40; i++) {
    const s = spawnSync(DRIVER_BIN, ["status"], { encoding: "utf-8", windowsHide: true });
    if (s.stdout && /daemon is running/i.test(s.stdout)) {
      return { alreadyRunning: false };
    }
    // eslint-disable-next-line no-await-in-loop
    const start = Date.now();
    while (Date.now() - start < 250) {
      /* busy-wait */
    }
  }
  throw new Error("cua-driver daemon did not become ready after startDaemon()");
}

/** Stop the cua-driver daemon. Returns the driver's status output. */
export function stopDaemon() {
  const result = spawnSync(DRIVER_BIN, ["stop"], { encoding: "utf-8", windowsHide: true });
  return result.stdout || result.stderr || "";
}

// ---------------------------------------------------------------------------
// Window / state queries
// ---------------------------------------------------------------------------

/**
 * List every top-level window known to the window manager.
 * Returns the structured `windows` array (falls back to `_legacy_windows`).
 */
export function listWindows(opts = {}) {
  const res = call("list_windows", opts);
  return res.windows || res._legacy_windows || [];
}

/**
 * Walk a window's UIA tree. Returns the full parsed response, which includes
 * `elements` (structured array with `element_index`, `element_token`, `role`,
 * `label`, `frame`, `enabled`, …), `tree_markdown`, `pid` and `window_id`.
 */
export function getWindowState(pid, windowId, opts = {}) {
  return call("get_window_state", { pid, window_id: windowId, ...opts });
}

// ---------------------------------------------------------------------------
// Input actions
// ---------------------------------------------------------------------------

/**
 * Left-click at window-local pixel coordinates (x, y) relative to the window's
 * content screenshot. Prefer `clickElement` (element_token) for UIA-exposed
 * elements — pixel clicks are for canvas / custom-drawn surfaces.
 */
export function click(pid, x, y, windowId) {
  const args = { pid, x, y };
  if (windowId) args.window_id = windowId;
  return call("click", args);
}

/**
 * Click a UIA element by its `element_token` (from a fresh get_window_state).
 * Performs the UIA Invoke pattern via PostMessage — no cursor move, no focus
 * steal, works on backgrounded windows. This is the most reliable way to click
 * web-content elements.
 */
export function clickElement(pid, windowId, elementToken) {
  return call("click", { pid, window_id: windowId, element_token: elementToken });
}

/**
 * Type text into the target pid. When `elementToken` is supplied the text is
 * written through the UIA ValuePattern on that exact element (required for
 * XAML/WinUI hosts; also reliable for web inputs). Otherwise it is delivered
 * to the focused window via PostMessage(WM_CHAR).
 */
export function typeText(pid, text, windowId, elementToken) {
  const args = { pid, text };
  if (windowId) args.window_id = windowId;
  if (elementToken) args.element_token = elementToken;
  return call("type_text", args);
}

/**
 * Press and release a single key (return, tab, escape, arrows, space, delete,
 * home, end, pageup, pagedown, f1-f12, letters, digits). Optional modifiers
 * array (ctrl/shift/alt/win). For true combos prefer `hotkey`.
 */
export function pressKey(pid, key, windowId, opts = {}) {
  const args = { pid, key, ...opts };
  if (windowId) args.window_id = windowId;
  return call("press_key", args);
}

/**
 * Press a key combination simultaneously, e.g. ["ctrl", "k"]. Tauri/Chromium
 * surfaces drop background hotkeys, so this retries with foreground delivery
 * when the driver reports `background_unavailable`.
 */
export function hotkey(pid, keys, windowId, opts = {}) {
  const args = { pid, keys, ...opts };
  if (windowId) args.window_id = windowId;
  return callWithForegroundFallback("hotkey", args);
}

/**
 * Scroll the target's focused region. `direction` is "up"|"down"|"left"|
 * "right"; `amount` is the number of ticks. Retries with foreground delivery
 * when background input is dropped.
 */
export function scroll(pid, direction, amount, windowId, opts = {}) {
  const args = { pid, direction, amount, ...opts };
  if (windowId) args.window_id = windowId;
  return callWithForegroundFallback("scroll", args);
}

/**
 * Bring a window to the OS foreground. This deliberately breaks the
 * no-foreground contract — use it only when a surface must stay foreground
 * across multiple calls (e.g. RDP), not for ordinary clicks.
 */
export function bringToFront(pid, windowId) {
  const args = { pid };
  if (windowId) args.window_id = windowId;
  return call("bring_to_front", args);
}

/**
 * Capture a screenshot of a window to `outPath` (PNG). Returns the parsed
 * get_window_state response, which includes `screenshot_file_path`.
 */
export function screenshot(pid, windowId, outPath) {
  return call("get_window_state", { pid, window_id: windowId, screenshot_out_file: outPath });
}

/**
 * Capture a full-display screenshot to `outPath` (PNG). Vision-only — no UIA
 * tree. Useful for desktop-scope verification.
 */
export function desktopScreenshot(outPath) {
  return call("get_desktop_state", { screenshot_out_file: outPath });
}

/** True when the cua-driver binary exists on disk. */
export function isDriverInstalled() {
  return existsSync(DRIVER_BIN);
}
