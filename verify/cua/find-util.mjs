// find-util.mjs — correct element find/click helpers for cua-driver tests.
//
// The harness's helpers.mjs `findElement` has an inverted text filter (it
// always returns the first element that passes the role/name checks, ignoring
// `text`). Since helpers.mjs is off-limits to modification, this module
// provides a correct `findBy` / `clickBy` that match on text (case-insensitive
// substring), role, and/or name — and click via element_token (UIA Invoke) or
// a pixel click at the element's centre.

import { performance } from "node:perf_hooks";
import { click, clickElement as driverClickElement, driverErrorCode, getWindowState, sleep } from "./driver.mjs";
import { elementCenter } from "./helpers.mjs";

function parseTreeNode(line) {
  const prefix = String(line).match(/^(\s*)-\s+(.*)$/);
  if (!prefix) return null;
  const match = prefix[2].match(
    /^(?:\[(\d+)\]\s+)?([A-Za-z][A-Za-z0-9_-]*)(?:\s+"([^"]*)")?(?:\s+(.*))?$/,
  );
  return {
    indent: prefix[1].length,
    index: match?.[1] == null ? null : Number(match[1]),
    role: match?.[2] ?? null,
    label: match?.[3] ?? "",
    metadata: match?.[4] ?? "",
  };
}

function hasScrollAction(node) {
  return /\bactions=\[[^\]]*\bscroll\b/.test(node.metadata);
}

function indexedScrollTarget(node, byIndex) {
  if (node.index == null || !hasScrollAction(node)) return undefined;
  const element = byIndex(node.index);
  return Array.isArray(element?.actions) && element.actions.includes("scroll") ? element : undefined;
}

/**
 * Resolve a named semantic region to an indexed UIA element that advertises a
 * scroll action. WebView2 may render `role=region` as an unindexed Group in
 * `tree_markdown`; when `allowAncestors` is true and the region has no indexed
 * scrollable descendant, the nearest indexed scrollable ancestor (often the
 * Document) is the native action target. Region-specific callers should set
 * `allowAncestors: false` so they cannot mistake a parent scroller for the
 * named region's own ScrollPattern. Preserve the token from this snapshot.
 */
export function findNamedRegionScrollElement(windowState, regionName, { allowAncestors = true } = {}) {
  const lines = String(windowState?.tree_markdown ?? "").split(/\r?\n/);
  const elements = windowState?.elements ?? [];
  const byIndex = (index) => elements.find((element) => Number(element.element_index) === index);
  const stack = [];
  let regionEntry;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const node = parseTreeNode(lines[lineIndex]);
    if (!node) continue;
    while (stack.length && stack[stack.length - 1].indent >= node.indent) stack.pop();

    if (["Group", "Pane", "Region"].includes(node.role) && node.label === regionName) {
      regionEntry = { lineIndex, node, ancestors: [...stack] };
      break;
    }
    stack.push(node);
  }
  if (!regionEntry) return undefined;

  const { lineIndex: regionLine, node: region, ancestors } = regionEntry;
  const regionElement = indexedScrollTarget(region, byIndex);
  if (regionElement) return regionElement;

  for (let i = regionLine + 1; i < lines.length; i += 1) {
    const candidate = parseTreeNode(lines[i]);
    if (!candidate) continue;
    if (candidate.indent <= region.indent) break;
    if (!["Group", "Pane", "Region"].includes(candidate.role)) continue;
    const element = indexedScrollTarget(candidate, byIndex);
    if (element) return element;
  }

  if (allowAncestors) {
    for (let i = ancestors.length - 1; i >= 0; i -= 1) {
      const element = indexedScrollTarget(ancestors[i], byIndex);
      if (element) return element;
    }
  }
  return undefined;
}

/**
 * Find a structured element that is actually inside a named native-tree
 * region. A scrollable ancestor such as the WebView Document may be actionable
 * but its center can lie in an unrelated sibling panel; callers can use this
 * element's frame as an in-region pointer target for wheel input. Returns the
 * first tree-order match; callers must validate its native frame and fail
 * closed when it is missing or outside the window rather than guessing.
 */
export function findNamedRegionDescendantElement(windowState, regionName, criteria = {}) {
  const lines = String(windowState?.tree_markdown ?? "").split(/\r?\n/);
  const byIndex = new Map();
  for (const element of windowState?.elements ?? []) {
    const index = Number(element.element_index);
    if (Number.isInteger(index) && !byIndex.has(index)) byIndex.set(index, element);
  }

  let regionIndent = null;
  const textNeedle = criteria.text ? String(criteria.text).toLowerCase() : null;
  for (const line of lines) {
    const node = parseTreeNode(line);
    if (!node) continue;

    if (regionIndent === null) {
      if (["Group", "Pane", "Region"].includes(node.role) && node.label === regionName) {
        regionIndent = node.indent;
      }
      continue;
    }

    if (node.indent <= regionIndent) break;
    if (node.index == null) continue;
    const element = byIndex.get(node.index);
    if (!element) continue;
    if (criteria.role && element.role !== criteria.role) continue;
    if (criteria.name && element.label !== criteria.name) continue;
    if (textNeedle && !String(element.label ?? "").toLowerCase().includes(textNeedle)) continue;
    return element;
  }
  return undefined;
}

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
  const initialWindowId = windowState.window_id;
  const clickMatching = (state) => {
    const el = findBy(state, criteria);
    if (!el) {
      throw new Error(`Element not found: ${JSON.stringify(criteria)}`);
    }
    const windowId = state.window_id ?? initialWindowId;
    if (el.element_token) {
      return driverClickElement(pid, windowId, el.element_token);
    }
    const { x, y } = elementCenter(el, state);
    return click(pid, x, y, windowId);
  };

  try {
    return clickMatching(windowState);
  } catch (error) {
    // Screenshot capture and unrelated UI updates can invalidate a token after
    // the caller took its snapshot. Re-query and re-find only on the driver's
    // explicit stale-token refusal; all other errors remain fail-closed.
    if (driverErrorCode(error) !== "stale_element_token") throw error;
    if (initialWindowId === undefined || initialWindowId === null) {
      throw new Error("Refusing stale-element retry without the original window identity", { cause: error });
    }
    const refreshed = getWindowState(pid, initialWindowId, { include_screenshot: false });
    if (
      !refreshed ||
      typeof refreshed !== "object" ||
      refreshed.pid === undefined ||
      refreshed.pid === null ||
      refreshed.window_id === undefined ||
      refreshed.window_id === null
    ) {
      throw new Error("Refusing stale-element retry because refreshed identity fields are missing", { cause: error });
    }
    if (refreshed.pid !== pid || refreshed.window_id !== initialWindowId) {
      throw new Error(
        `Refusing stale-element retry because window identity changed (pid ${refreshed.pid}; window_id ${refreshed.window_id})`,
        { cause: error },
      );
    }
    return clickMatching(refreshed);
  }
}

/** Poll fresh UIA snapshots until every requested element is present or time expires. */
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

/** Poll get_window_state until an element matching criteria appears. */
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
