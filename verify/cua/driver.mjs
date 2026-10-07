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
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, win32 } from "node:path";
import { fileURLToPath } from "node:url";

/** Resolve cua-driver from an explicit override or the current user's install. */
export function resolveDriverBin({
  env = process.env,
  platform = process.platform,
  homeDir = homedir(),
} = {}) {
  if (env.CUA_DRIVER_BIN) return env.CUA_DRIVER_BIN;
  if (platform !== "win32") return "cua-driver";

  const localAppData = env.LOCALAPPDATA || win32.join(homeDir, "AppData", "Local");
  return win32.join(
    localAppData,
    "Programs",
    "Cua",
    "cua-driver",
    "bin",
    "cua-driver.exe",
  );
}

export const DRIVER_BIN = resolveDriverBin();
// One-shot CLI calls need a stable public session label to share screenshot
// context across the observation/action boundary. The process ID keeps
// parallel suite processes isolated while remaining constant within a suite.
export const CUA_SESSION = process.env.CUA_SESSION || `sophos-${process.pid}`;
const screenshotContexts = new Set();
const SCREENSHOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "screenshots");
/**
 * All v0.33.4 tool schemas accept an optional public session label. Include it
 * on every one-shot call so snapshots and every subsequent action share one run.
 */
export function sessionScopedPayload(_tool, args = {}, session = CUA_SESSION) {
  if (args.session != null) return args;
  return { ...args, session };
}

function screenshotContextKey(pid, windowId, session) {
  return `${session}:${pid}:${windowId}`;
}

/** Small sleep helper (ms). */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Invoke a cua-driver tool with a JSON payload piped via stdin.
 * Returns the parsed JSON result. Throws on non-zero exit or a plain-text
 * error payload (the driver reports some failures as text, not JSON).
 */
export function call(tool, args = {}, invoke = spawnSync) {
  // Any action may change the screen behind a cached coordinate snapshot.
  // The next pixel click must obtain a fresh screenshot in the same session.
  if (tool !== "get_window_state") screenshotContexts.clear();
  const payload = sessionScopedPayload(tool, args);
  const result = invoke(DRIVER_BIN, ["call", tool], {
    input: JSON.stringify(payload),
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
export function driverErrorCode(error) {
  if (typeof error?.code === "string") return error.code;
  if (typeof error?.refusal?.code === "string") return error.refusal.code;

  const message = error instanceof Error ? error.message : String(error ?? "");
  const payloadStart = message.indexOf("{");
  if (payloadStart < 0) return null;
  try {
    const payload = JSON.parse(message.slice(payloadStart));
    if (typeof payload?.refusal?.code === "string") return payload.refusal.code;
    return typeof payload?.code === "string" ? payload.code : null;
  } catch {
    return null;
  }
}

export function callWithForegroundFallback(tool, args = {}) {
  let first;
  try {
    first = call(tool, args);
  } catch (error) {
    if (driverErrorCode(error) !== "background_unavailable") throw error;
    return call(tool, { ...args, delivery_mode: "foreground" });
  }

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
  screenshotContexts.clear();
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
  screenshotContexts.clear();
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
export function getWindowState(pid, windowId, opts = {}, invoke = call) {
  const session = opts.session ?? CUA_SESSION;
  const result = invoke("get_window_state", { pid, window_id: windowId, ...opts, session });
  const contextKey = screenshotContextKey(pid, windowId, session);
  if (
    opts.include_screenshot === true ||
    (opts.include_screenshot !== false && opts.screenshot_out_file)
  ) {
    screenshotContexts.add(contextKey);
  } else {
    screenshotContexts.delete(contextKey);
  }
  return result;
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
  return clickWithScreenshotContext(pid, x, y, windowId, CUA_SESSION, call);
}

/**
 * Pixel actions require a screenshot-bearing snapshot owned by the same CUA
 * session. Refresh it on demand when the caller's most recent UIA read omitted
 * its screenshot; this preserves the coordinate action instead of silently
 * weakening or dropping UI coverage.
 */
export function clickWithScreenshotContext(
  pid,
  x,
  y,
  windowId,
  session = CUA_SESSION,
  invoke = call,
  screenshotOutFile,
) {
  if (!windowId) {
    throw new Error("Pixel clicks require a windowId to capture same-session screenshot context");
  }
  const contextKey = screenshotContextKey(pid, windowId, session);
  if (!screenshotContexts.has(contextKey)) {
    const capturePath = screenshotOutFile ?? join(SCREENSHOT_DIR, `click-context-${process.pid}-${pid}.png`);
    mkdirSync(dirname(capturePath), { recursive: true });
    getWindowState(pid, windowId, { include_screenshot: true, screenshot_out_file: capturePath, session }, invoke);
  }
  const args = { pid, x, y, session };
  args.window_id = windowId;
  return invoke("click", args);
}

/**
 * Click a UIA element by its `element_token` (from a fresh get_window_state).
 * Performs the UIA Invoke pattern via PostMessage — no cursor move, no focus
 * steal, works on backgrounded windows. This is the most reliable way to click
 * web-content elements.
 */
export function clickElement(pid, windowId, elementToken) {
  return call("click", { pid, window_id: windowId, element_token: elementToken, session: CUA_SESSION });
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
  if (windowId && !opts.element_token) args.window_id = windowId;
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
  return getWindowState(pid, windowId, { include_screenshot: true, screenshot_out_file: outPath });
}

/**
 * Capture a full-display screenshot to `outPath` (PNG). Vision-only — no UIA
 * tree. Useful for desktop-scope verification.
 */
export function desktopScreenshot(outPath) {
  return call("get_desktop_state", { screenshot_out_file: outPath });
}

/** True when the explicit binary exists or a bare command resolves on PATH. */
export function isDriverInstalled() {
  if (/[\\/]/.test(DRIVER_BIN)) return existsSync(DRIVER_BIN);
  const result = spawnSync(DRIVER_BIN, ["--version"], { encoding: "utf-8", windowsHide: true, timeout: 5_000 });
  return !result.error && result.status === 0;
}
