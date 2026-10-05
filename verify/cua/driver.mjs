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
import path from "node:path";

/** Resolve cua-driver's installed path without assuming a particular user. */
export function resolveDriverBin({ env = process.env, platform = process.platform } = {}) {
  if (env.CUA_DRIVER_BIN) return env.CUA_DRIVER_BIN;
  if (platform === "win32" && env.LOCALAPPDATA) {
    return path.win32.join(
      env.LOCALAPPDATA,
      "Programs",
      "Cua",
      "cua-driver",
      "bin",
      "cua-driver.exe",
    );
  }
  return "cua-driver";
}

/** Path to the cua-driver binary. CI may set CUA_DRIVER_BIN explicitly. */
export const DRIVER_BIN = resolveDriverBin();

/** Stable label shared by every one-shot CLI call in this Node process. */
export const DRIVER_SESSION = process.env.CUA_DRIVER_SESSION || `sophos-ui-${process.pid}`;

/** Add the caller-declared session to one-shot CLI tool arguments. */
export function withSession(args = {}, session = DRIVER_SESSION) {
  return { ...args, session: args.session ?? session };
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
function invokeDriverCall(tool, args = {}, { timeoutMs } = {}) {
  const spawnOptions = {
    input: JSON.stringify(args),
    encoding: "utf-8",
    windowsHide: true,
  };
  if (timeoutMs !== undefined) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new RangeError("timeoutMs must be a finite positive number");
    }
    spawnOptions.timeout = Math.max(1, Math.ceil(timeoutMs));
  }
  const result = spawnSync(DRIVER_BIN, ["call", tool], spawnOptions);

  if (result.error) {
    const message = result.error.code === "ETIMEDOUT"
      ? `cua-driver call ${tool} timed out after ${spawnOptions.timeout}ms`
      : `cua-driver call ${tool} failed to spawn: ${result.error.message}`;
    const error = new Error(message, { cause: result.error });
    error.code = result.error.code;
    throw error;
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
 * Keep snapshot and pixel actions in one named CUA session across one-shot CLI
 * processes. `invokeTool` is injectable so session lifecycle can be unit-tested.
 */
export function createSessionInvoker(invokeTool, defaultSession = DRIVER_SESSION) {
  const activeSessions = new Set();

  const invoke = (tool, args = {}, callOptions = {}) => {
    const payload = withSession(args, defaultSession);
    const session = payload.session;

    if (tool === "start_session") {
      const result = invokeTool(tool, payload, callOptions);
      activeSessions.add(session);
      return result;
    }
    if (tool === "end_session") {
      const result = invokeTool(tool, payload, callOptions);
      activeSessions.delete(session);
      return result;
    }
    if (!activeSessions.has(session)) {
      invokeTool("start_session", { session });
      activeSessions.add(session);
    }
    return invokeTool(tool, payload, callOptions);
  };

  invoke.endAll = () => {
    for (const session of activeSessions) {
      try {
        invokeTool("end_session", { session });
      } catch {
        // The daemon may already have stopped during runner teardown.
      }
    }
    activeSessions.clear();
  };

  return invoke;
}

const callInSession = createSessionInvoker(invokeDriverCall);
process.once("exit", callInSession.endAll);

/**
 * Invoke a CUA tool in the current Node process's named session.
 * Returns parsed JSON and throws on CLI/tool errors.
 */
export function call(tool, args = {}, callOptions = {}) {
  return callInSession(tool, args, callOptions);
}

function hasBackgroundUnavailableCode(value) {
  return Boolean(
    value && typeof value === "object" && (
      value.code === "background_unavailable" ||
      value.structuredContent?.code === "background_unavailable" ||
      value.structured_content?.code === "background_unavailable"
    ),
  );
}

function isBackgroundUnavailableError(error) {
  if (hasBackgroundUnavailableCode(error)) return true;
  const message = error instanceof Error ? error.message : String(error ?? "");
  const start = message.indexOf("{");
  const end = message.lastIndexOf("}");
  if (start < 0 || end <= start) return false;
  try {
    return hasBackgroundUnavailableCode(JSON.parse(message.slice(start, end + 1)));
  } catch {
    return false;
  }
}

/**
 * Run a tool in background mode first. Retry only an explicit
 * `background_unavailable` refusal once in foreground; propagate every other
 * error unchanged. `invoke` is injectable so the escalation rule is testable.
 */
export function invokeWithForegroundFallback(invoke, tool, args = {}) {
  let first;
  try {
    first = invoke(tool, args);
  } catch (error) {
    if (args.delivery_mode === "foreground" || !isBackgroundUnavailableError(error)) {
      throw error;
    }
    return invoke(tool, { ...args, delivery_mode: "foreground" });
  }

  if (args.delivery_mode !== "foreground" && isBackgroundUnavailableError(first)) {
    return invoke(tool, { ...args, delivery_mode: "foreground" });
  }
  return first;
}

export function callWithForegroundFallback(tool, args = {}) {
  return invokeWithForegroundFallback(call, tool, args);
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
  callInSession.endAll();
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
export function getWindowState(pid, windowId, opts = {}, callOptions = {}) {
  return call("get_window_state", { pid, window_id: windowId, ...opts }, callOptions);
}

/**
 * Capture UIA state and screenshot before a coordinate-based click.
 * Windows CUA pixel actions require the screenshot context from this response.
 * `invoke` is injectable only at the CLI boundary for unit testing.
 */
export function getWindowStateForPixelClick(pid, windowId, invoke = call) {
  return invoke("get_window_state", {
    pid,
    window_id: windowId,
    include_screenshot: true,
  });
}

// ---------------------------------------------------------------------------
// Input actions
// ---------------------------------------------------------------------------

/**
 * Left-click at window-local pixel coordinates (x, y) relative to the window's
 * content screenshot. Prefer `clickElement` (element_token) for UIA-exposed
 * elements — pixel clicks are for canvas / custom-drawn surfaces. `opts` is
 * forwarded to the driver, and explicit background refusals may escalate once.
 */
export function click(pid, x, y, windowId, opts = {}) {
  const args = { pid, x, y, ...opts };
  if (windowId) args.window_id = windowId;
  return callWithForegroundFallback("click", args);
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
