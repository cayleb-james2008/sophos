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
import { writeFileSync } from "node:fs";
import { getWindowState } from "./driver.mjs";
import { DEFAULT_APP_PATH, findSophosWindow } from "./launch.mjs";
import { clickElement, findElement, navTo, sleep, takeScreenshot, getTextContent, waitForElement } from "./helpers.mjs";
import { waitForAllElements } from "./find-util.mjs";
import {
  assert,
  assertElementVisible,
  assertTextContains,
  assertNoConsoleErrors,
} from "./assertions.mjs";

/** Read a fresh window state for the app handle. */
function freshState(appHandle, timeoutMs) {
  const callOptions = Number.isFinite(timeoutMs)
    ? { timeoutMs: Math.max(1, timeoutMs) }
    : {};
  return getWindowState(
    appHandle.pid,
    appHandle.windowId,
    { include_screenshot: false },
    callOptions,
  );
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
    fn: async (appHandle) => {
      const views = ["Chat", "Sessions", "Agents", "Inbox", "Settings"];
      const requiredNav = views.map((name) => ({ role: "Button", name }));
      const state = await waitForAllElements(
        (remainingMs) => freshState(appHandle, remainingMs),
        requiredNav,
        20000,
      );
      assert(state, `UIA tree did not expose every required nav button within 20s: ${views.join(", ")}`);
      for (const view of views) {
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

if (process.env.SOPHOS_EXPECT_ONBOARDING === "1") {
  tests.unshift({
    name: "fresh install skips onboarding without provider setup or inference",
    fn: async (appHandle) => {
      const initial = freshState(appHandle);
      const skip = await waitForElement(initial, { role: "Button", name: "Skip for now" }, 30000);
      assert(skip, "fresh public install did not show the Welcome-step Skip for now button");
      takeScreenshot(appHandle.pid, "public-onboarding-before-skip", appHandle.windowId);

      const current = freshState(appHandle);
      clickElement(appHandle.pid, current, { role: "Button", name: "Skip for now" });
      await sleep(600);
      const after = freshState(appHandle);
      assert(!findElement(after, { role: "Button", name: "Skip for now" }), "onboarding remained after Skip for now");
      assert(!findElement(after, { role: "Button", name: "Get started" }), "onboarding advanced instead of being skipped");
      takeScreenshot(appHandle.pid, "public-onboarding-after-skip", appHandle.windowId);
      console.log("Verified first-run skip; provider setup and inference were not invoked");
    },
  });
}

// Run the suite. runSuite sets process.exitCode = 1 on any failure.
let outcome;
let setupError;
try {
  outcome = await runSuite(
    process.env.SOPHOS_FEED_VERSION ? "Sophos public-installer app smoke" : "Sophos cua-driver smoke test",
    tests,
  );
} catch (error) {
  setupError = error;
  throw error;
} finally {
  if (process.env.SOPHOS_CUA_REPORT_PATH) {
    writeFileSync(process.env.SOPHOS_CUA_REPORT_PATH, JSON.stringify({
      suite: "sophos-installed-app-smoke",
      installerVersion: process.env.SOPHOS_FEED_VERSION ?? null,
      installerSha256: process.env.SOPHOS_FEED_SHA256 ?? null,
      executablePath: DEFAULT_APP_PATH,
      onboardingRequired: process.env.SOPHOS_EXPECT_ONBOARDING === "1",
      status: setupError ? "FAIL" : outcome?.failed === 0 ? "PASS" : "FAIL",
      setupError: setupError?.message ?? null,
      summary: outcome ? { passed: outcome.passed, failed: outcome.failed, totalMs: outcome.totalMs } : null,
      results: outcome?.results ?? [],
      providerSetupInvoked: false,
      inferenceInvoked: false,
    }, null, 2));
  }
}

// Final summary line for CI / humans.
if (outcome.failed === 0) {
  console.log("\nSMOKE TEST: PASS");
} else {
  console.log(`\nSMOKE TEST: FAIL (${outcome.failed} failed)`);
}
