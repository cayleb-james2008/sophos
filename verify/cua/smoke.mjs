// smoke.mjs — smoke test that proves the cua-driver harness works end-to-end
// against the real Sophos desktop app.
//
// Run:  node verify/cua/smoke.mjs
//
// Flow:
//   1. Launch the app (beforeAll in runner.mjs).
//   2. Find the Sophos window via cua-driver.
//   3. Read the UIA tree.
//   4. Take a screenshot.
//   5. Click the "Sessions" nav button.
//   6. Verify the Sessions view loaded.
//   7. Click back to "Chat".
//   8. Verify the Chat view loaded.
//   9. Take a final screenshot.
//  10. Report pass/fail (exit code 0 on success, 1 on failure).

import { runSuite } from "./runner.mjs";
import { getWindowState } from "./driver.mjs";
import { findSophosWindow } from "./launch.mjs";
import { navTo, takeScreenshot, getTextContent, waitForElement } from "./helpers.mjs";
import {
  assert,
  assertElementVisible,
  assertTextContains,
  assertNoConsoleErrors,
} from "./assertions.mjs";

/** Read a fresh window state for the app handle. */
function freshState(appHandle) {
  return getWindowState(appHandle.pid, appHandle.windowId, { include_screenshot: false });
}

const tests = [
  {
    name: "finds the Sophos window via cua-driver",
    fn: (appHandle) => {
      const found = findSophosWindow();
      assert(found, "Sophos window not found via list_windows");
      assert(found.pid === appHandle.pid, `pid mismatch: ${found.pid} vs ${appHandle.pid}`);
      assert(found.windowId === appHandle.windowId, "windowId mismatch");
    },
  },

  {
    name: "reads the UIA tree (nav buttons present)",
    fn: (appHandle) => {
      const state = freshState(appHandle);
      assert(state.elements && state.elements.length > 0, "UIA tree is empty");
      for (const view of ["Chat", "Sessions", "Agents", "Inbox", "Settings"]) {
        assertElementVisible(state, { role: "Button", name: view });
      }
    },
  },

  {
    name: "takes a screenshot",
    fn: (appHandle) => {
      const outPath = takeScreenshot(appHandle.pid, "smoke-initial", appHandle.windowId);
      assert(outPath.endsWith("smoke-initial.png"), `unexpected path: ${outPath}`);
    },
  },

  {
    name: "navigates to Sessions and verifies the view loaded",
    fn: async (appHandle) => {
      const state = freshState(appHandle);
      navTo(appHandle.pid, state, "Sessions");
      // Wait for the Sessions view to render (poll the UIA tree).
      const marker = await waitForElement(state, { text: "SESSION GRAPH" }, 8000);
      assert(marker, "Sessions view did not render (SESSION GRAPH not found)");
      const after = freshState(appHandle);
      assertTextContains(after, "Session command center");
    },
  },

  {
    name: "navigates back to Chat and verifies the view loaded",
    fn: async (appHandle) => {
      const state = freshState(appHandle);
      navTo(appHandle.pid, state, "Chat");
      // Wait for the Chat view to render (poll the UIA tree).
      const marker = await waitForElement(state, { text: "CHAT" }, 8000);
      assert(marker, "Chat view did not render (CHAT not found)");
      const after = freshState(appHandle);
      assertTextContains(after, "Conversation");
    },
  },

  {
    name: "no console errors (placeholder check)",
    fn: () => {
      assertNoConsoleErrors();
    },
  },
];

// Run the suite. runSuite sets process.exitCode = 1 on any failure.
const outcome = await runSuite("Sophos cua-driver smoke test", tests);

// Final summary line for CI / humans.
if (outcome.failed === 0) {
  console.log("\nSMOKE TEST: PASS");
} else {
  console.log(`\nSMOKE TEST: FAIL (${outcome.failed} failed)`);
}
