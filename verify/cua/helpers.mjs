// helpers.mjs — test helpers built on driver.mjs + launch.mjs.
//
// These operate on a `windowState` object returned by `getWindowState`, which
// carries `pid`, `window_id`, `elements` (structured UIA array) and
// `tree_markdown`. Elements expose `{ element_index, element_token, role,
// label, frame, enabled, … }`.
//
// Clicking strategy: `clickElement` prefers the element's `element_token`
// (UIA Invoke via PostMessage — no coordinates, no focus steal, works on
// backgrounded windows). It falls back to a pixel click at the element's
// centre bounds for elements without a token (e.g. canvas surfaces).

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getWindowState,
  click,
  clickElement as driverClickElement,
  listWindows,
  sleep,
} from "./driver.mjs";
import { findSophosWindow } from "./launch.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Directory where screenshots are saved. */
export const SCREENSHOT_DIR = path.join(__dirname, "screenshots");

/**
 * Convert screen coordinates (the space element `frame` values are reported
 * in) to window-local pixels (the space `click(x, y)` expects). The window's
 * content screenshot is slightly smaller than its OS bounds (borders), so the
 * content origin is the window origin plus half the difference.
 */
export function toWindowLocal(screenX, screenY, windowState) {
  const win = listWindows({ pid: windowState.pid }).find(
    (w) => w.window_id === windowState.window_id,
  );
  const sw = windowState.screenshot_width;
  const sh = windowState.screenshot_height;
  if (!win || !sw || !sh) {
    // Fall back to assuming the frame is already window-local.
    return { x: screenX, y: screenY };
  }
  const ox = win.bounds.x + (win.bounds.width - sw) / 2;
  const oy = win.bounds.y + (win.bounds.height - sh) / 2;
  return { x: screenX - ox, y: screenY - oy };
}

/**
 * Search a window state's UIA tree for an element matching the criteria.
 * Criteria: `{ text, role, name }` — `name` is an exact label match, `role` an
 * exact role match, `text` a case-insensitive substring of the label. Returns
 * the element (with its frame) or undefined.
 */
export function findElement(windowState, { text, role, name } = {}) {
  const elements = windowState.elements || [];
  const needle = text ? String(text).toLowerCase() : null;
  return elements.find((e) => {
    if (role && e.role !== role) return false;
    if (name && e.label !== name) return false;
    if (needle && !String(e.label || "").toLowerCase().includes(needle)) return false;
    return true;
  });
}

/**
 * Find an element and click it. Prefers the element's `element_token` (UIA
 * Invoke); falls back to a pixel click at the element's centre bounds.
 */
export function clickElement(pid, windowState, criteria = {}) {
  const el = findElement(windowState, criteria);
  if (!el) {
    throw new Error(`Element not found: ${JSON.stringify(criteria)}`);
  }
  const windowId = windowState.window_id;
  if (el.element_token) {
    return driverClickElement(pid, windowId, el.element_token);
  }
  const { x, y } = elementCenter(el, windowState);
  return click(pid, x, y, windowId);
}

/** Compute the window-local centre of an element's frame. */
export function elementCenter(el, windowState) {
  const frame = el.frame;
  const cx = frame.x + frame.w / 2;
  const cy = frame.y + frame.h / 2;
  const { x, y } = toWindowLocal(cx, cy, windowState);
  return { x: Math.round(x), y: Math.round(y) };
}

/**
 * Click a sidebar nav button (Chat, Sessions, Agents, Inbox, Settings) by its
 * exact label. Returns the click result.
 */
export function navTo(pid, windowState, viewName) {
  return clickElement(pid, windowState, { role: "Button", name: viewName });
}

/**
 * Poll get_window_state until an element matching the criteria appears (or
 * `timeoutMs` elapses). Returns the element or null. `windowState` supplies
 * the pid + window_id to poll.
 */
export async function waitForElement(windowState, criteria, timeoutMs = 10000) {
  const pid = windowState.pid;
  const windowId = windowState.window_id;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const fresh = getWindowState(pid, windowId, { include_screenshot: false });
    const el = findElement(fresh, criteria);
    if (el) return el;
    await sleep(250);
  }
  return null;
}

/**
 * Save a screenshot of the app window to `verify/cua/screenshots/{name}.png`.
 * `windowId` is optional — when omitted the Sophos window is looked up.
 * Returns the absolute path to the saved PNG.
 */
export function takeScreenshot(pid, name, windowId) {
  const wid = windowId ?? findSophosWindow()?.windowId;
  if (!wid) throw new Error(`takeScreenshot: no Sophos window for pid ${pid}`);
  const outPath = path.join(SCREENSHOT_DIR, `${name}.png`);
  getWindowState(pid, wid, { screenshot_out_file: outPath });
  return outPath;
}

/**
 * Extract all visible text from a window state's UIA tree (one label per
 * line). Combines the structured `elements` array with quoted labels parsed
 * from `tree_markdown` — some text nodes appear only in the markdown and lack
 * an `element_index`. Useful for `assertTextContains` and for debugging.
 */
export function getTextContent(windowState) {
  const elements = windowState.elements || [];
  const labels = elements
    .map((e) => e.label)
    .filter((l) => l && String(l).trim().length > 0);

  const tm = windowState.tree_markdown || "";
  const tmText = [...tm.matchAll(/(?:Text|Button|TabItem|ComboBox|Edit|MenuItem|Heading)\s+"([^"]+)"/g)].map(
    (m) => m[1],
  );

  return [...new Set([...labels, ...tmText])].join("\n");
}
