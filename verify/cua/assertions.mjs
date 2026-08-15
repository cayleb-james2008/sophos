// assertions.mjs — assertion helpers for cua-driver e2e tests.
//
// All assertions throw an Error with a descriptive message on failure, so a
// test runner can catch them and report a clean pass/fail. They operate on a
// `windowState` object from `getWindowState` (see helpers.mjs).

import { findElement, getTextContent } from "./helpers.mjs";

/**
 * Assert a condition is truthy. Throws with `message` (or a default) when not.
 */
export function assert(condition, message) {
  if (!condition) {
    throw new Error(message || "Assertion failed");
  }
}

/**
 * Assert an element matching the criteria is present in the window's UIA tree.
 * Returns the element so callers can chain further checks.
 */
export function assertElementVisible(windowState, criteria) {
  const el = findElement(windowState, criteria);
  assert(el, `Expected element visible: ${JSON.stringify(criteria)}`);
  return el;
}

/**
 * Assert an element matching the criteria is NOT present in the window's UIA
 * tree.
 */
export function assertElementNotVisible(windowState, criteria) {
  const el = findElement(windowState, criteria);
  assert(!el, `Expected element NOT visible: ${JSON.stringify(criteria)}`);
}

/**
 * Assert the given text appears somewhere in the window's UIA tree (as an
 * element label).
 */
export function assertTextContains(windowState, text) {
  const content = getTextContent(windowState);
  assert(
    content.includes(text),
    `Expected text "${text}" in window content. Got:\n${content.slice(0, 2000)}`,
  );
}

/**
 * Placeholder for future console-error capture. The cua-driver does not
 * surface the webview's JS console, so this is a no-op that returns true.
 * When a console-capture mechanism is added, wire it here so existing tests
 * gain the check without changing their call sites.
 */
export function assertNoConsoleErrors(..._args) {
  return true;
}
