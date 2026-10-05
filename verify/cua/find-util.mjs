// find-util.mjs — correct element find/click helpers for cua-driver tests.
//
// The harness's helpers.mjs `findElement` has an inverted text filter (it
// always returns the first element that passes the role/name checks, ignoring
// `text`). Since helpers.mjs is off-limits to modification, this module
// provides a correct `findBy` / `clickBy` that match on text (case-insensitive
// substring), role, and/or name — and click via element_token (UIA Invoke) or
// a pixel click at the element's centre.

import { performance } from "node:perf_hooks";
import { click, clickElement as driverClickElement, getWindowState, sleep } from "./driver.mjs";
import { elementCenter } from "./helpers.mjs";

/**
 * Find an element in a window state's UIA tree matching the criteria.
 * Criteria: `{ text, role, name }` — `name` is an exact label match, `role` an
 * exact role match, `text` a case-insensitive substring of the label. All
 * provided criteria must match. Returns the element or undefined.
 */
export function findBy(windowState, { text, role, name } = {}) {
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
 * Poll fresh window states until every required UIA element is present.
 * A nonempty WebView2 tree can still be partial while its provider materializes;
 * callers that need a complete navigation surface must wait for the full set.
 * The deadline bounds retries and rejects late snapshots; it cannot preempt a
 * synchronous readState call that itself stalls. Returns the complete state or
 * null at the deadline.
 */
export async function waitForAllElements(readState, criteriaList, timeoutMs = 10000, {
  sleepFn = sleep,
  nowFn = performance.now.bind(performance),
} = {}) {
  if (typeof readState !== "function") throw new TypeError("readState must be a function");
  if (!Array.isArray(criteriaList) || criteriaList.length === 0) {
    throw new TypeError("criteriaList must contain at least one element query");
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new RangeError("timeoutMs must be a finite nonnegative number");
  }

  const deadline = nowFn() + timeoutMs;
  for (;;) {
    const remainingBeforeRead = deadline - nowFn();
    if (remainingBeforeRead <= 0) return null;

    let state;
    try {
      state = readState(remainingBeforeRead);
    } catch (error) {
      if (error?.code === "ETIMEDOUT" || nowFn() >= deadline) return null;
      throw error;
    }
    if (nowFn() >= deadline) return null;
    if (criteriaList.every((criteria) => findBy(state, criteria))) return state;

    const remaining = deadline - nowFn();
    if (remaining <= 0) return null;
    await sleepFn(Math.min(250, remaining));
  }
}

/** Find ALL elements matching the criteria (same matching rules as findBy). */
export function findAll(windowState, { text, role, name } = {}) {
  const elements = windowState.elements || [];
  const needle = text ? String(text).toLowerCase() : null;
  return elements.filter((e) => {
    if (role && e.role !== role) return false;
    if (name && e.label !== name) return false;
    if (needle && !String(e.label || "").toLowerCase().includes(needle)) return false;
    return true;
  });
}

/** Find the rightmost matching element (e.g. the detail inspector's action). */
export function findRightmost(windowState, criteria) {
  const matches = findAll(windowState, criteria);
  if (!matches.length) return undefined;
  return matches.reduce((best, e) => {
    const bx = best.frame ? best.frame.x : 0;
    const ex = e.frame ? e.frame.x : 0;
    return ex > bx ? e : best;
  });
}

/** Click the rightmost matching element (e.g. the detail inspector's action). */
export function clickRightmost(pid, windowState, criteria = {}) {
  const el = findRightmost(windowState, criteria);
  if (!el) {
    throw new Error(`Rightmost element not found: ${JSON.stringify(criteria)}`);
  }
  const windowId = windowState.window_id;
  if (el.element_token) {
    return driverClickElement(pid, windowId, el.element_token);
  }
  const { x, y } = elementCenter(el, windowState);
  return click(pid, x, y, windowId);
}

/**
 * Find an element and click it. Prefers the element's `element_token` (UIA
 * Invoke); falls back to a pixel click at the element's centre bounds.
 */
export function clickBy(pid, windowState, criteria = {}) {
  const el = findBy(windowState, criteria);
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

/**
 * Poll get_window_state until an element matching the criteria appears (or
 * `timeoutMs` elapses). Returns the element or null. Uses the correct `findBy`.
 */
export async function waitFor(windowState, criteria, timeoutMs = 10000) {
  const pid = windowState.pid;
  const windowId = windowState.window_id;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const fresh = getWindowState(pid, windowId, { include_screenshot: false });
    const el = findBy(fresh, criteria);
    if (el) return el;
    await sleep(250);
  }
  return null;
}
