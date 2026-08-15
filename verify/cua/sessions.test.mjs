// sessions.test.mjs — cua-driver e2e tests for ALL Sessions features in the
// Sophos desktop app, run in DEMO MODE (MockIpcClient) so the full UI is
// populated with simulated sessions and testable without a live daemon.
//
// Run:  node verify/cua/sessions.test.mjs
//
// Coverage:
//   - Graph view renders session nodes + edges
//   - Tree view renders the session context tree hierarchically
//   - Detail inspector shows session info when a node is clicked
//   - New session creates a new session
//   - Resume session loads the selected session
//   - Fork session creates a forked copy
//   - Clone session creates a clone
//   - Switch session changes the active session

import { getWindowState, sleep } from "./driver.mjs";
import { navTo, takeScreenshot, getTextContent } from "./helpers.mjs";
import { findBy, clickBy, waitFor, clickRightmost } from "./find-util.mjs";
import { assert, assertTextContains } from "./assertions.mjs";
import { runDemoSuite } from "./demo-runner.mjs";

/** Read a fresh window state for the app handle. */
function freshState(appHandle) {
  return getWindowState(appHandle.pid, appHandle.windowId, { include_screenshot: false });
}

/** Navigate to the Sessions view and wait for it to render. */
async function goSessions(appHandle) {
  const state = freshState(appHandle);
  navTo(appHandle.pid, state, "Sessions");
  const marker = await waitFor(state, { text: "SESSION GRAPH" }, 8000);
  assert(marker, "Sessions view did not render (SESSION GRAPH not found)");
  // Ensure graph mode — an earlier test may have left the view in tree mode.
  const graphTab = findBy(freshState(appHandle), { role: "TabItem", name: "Graph" });
  if (graphTab) {
    clickBy(appHandle.pid, freshState(appHandle), { role: "TabItem", name: "Graph" });
    await sleep(500);
  }
  // Wait for a session node to render (the graph nodes appear after the header).
  const node = await waitFor(state, { text: "Refactor auth module" }, 8000);
  assert(node, "Session node did not render (Refactor auth module not found)");
  await sleep(800);
  return freshState(appHandle);
}

/** Count occurrences of a substring in the window text content. */
function countText(state, needle) {
  const content = getTextContent(state);
  return content.split("\n").filter((l) => l.includes(needle)).length;
}

const tests = [
  {
    name: "Sessions graph view renders session nodes and edges",
    fn: async (appHandle) => {
      const after = await goSessions(appHandle);
      assertTextContains(after, "SESSION GRAPH");
      // Session nodes.
      assertTextContains(after, "Refactor auth module");
      assertTextContains(after, "Migrate to new config schema");
      assertTextContains(after, "Sophos — Windows");
      // Graph edges (session-0 → goal, session-0 → rlm children).
      assertTextContains(after, "Edge from session-0 to goal-session-0-goal-demo");
      assertTextContains(after, "Edge from session-0 to rlm-session-0-rlm-1");
      // Goal + RLM child nodes.
      assertTextContains(after, "Ship the release and verify every published artifact");
      assertTextContains(after, "api-reviewer");
      assertTextContains(after, "test-runner");
      takeScreenshot(appHandle.pid, "sessions-graph", appHandle.windowId);
    },
  },

  {
    name: "Sessions tree view renders the context tree hierarchically",
    fn: async (appHandle) => {
      const state = await goSessions(appHandle);
      // Toggle to tree view.
      clickBy(appHandle.pid, state, { role: "TabItem", name: "Tree" });
      const marker = await waitFor(state, { text: "CONTEXT TREE" }, 8000);
      assert(marker, "Tree view did not render (CONTEXT TREE not found)");
      await sleep(800);
      const after = freshState(appHandle);
      assertTextContains(after, "CONTEXT TREE");
      // The demo tree has a root "Initial brief" with a child "Agent reply".
      assertTextContains(after, "Initial brief");
      assertTextContains(after, "Agent reply");
      takeScreenshot(appHandle.pid, "sessions-tree", appHandle.windowId);
    },
  },

  {
    name: "Detail inspector shows session info when a session node is clicked",
    fn: async (appHandle) => {
      const state = await goSessions(appHandle);
      // Click the "Migrate to new config schema" session node.
      const target = await waitFor(state, { text: "Migrate to new config schema" }, 8000);
      assert(target, "Migrate to new config schema node not found");
      const fresh = freshState(appHandle);
      clickBy(appHandle.pid, fresh, { text: "Migrate to new config schema" });
      await sleep(1000);
      const after = freshState(appHandle);
      // The inspector should now show this session's id + title.
      assertTextContains(after, "SESSION-1");
      assertTextContains(after, "Migrate to new config schema");
      // Inspector sections present.
      assertTextContains(after, "CONTEXT USAGE");
      assertTextContains(after, "SESSION INFO");
      takeScreenshot(appHandle.pid, "sessions-detail", appHandle.windowId);
    },
  },

  {
    name: "New session opens the modal and creates a new session",
    fn: async (appHandle) => {
      const state = await goSessions(appHandle);
      const before = countText(state, "SESSION");
      // Open the new-session modal.
      clickBy(appHandle.pid, state, { text: "New session" });
      const modal = await waitFor(state, { text: "Create session" }, 8000);
      assert(modal, "New session modal did not open (Create session not found)");
      takeScreenshot(appHandle.pid, "sessions-new-modal", appHandle.windowId);
      // Create the session.
      const modalState = freshState(appHandle);
      clickBy(appHandle.pid, modalState, { text: "Create session" });
      await sleep(1200);
      const after = freshState(appHandle);
      // The new session appears in the graph (session count increases).
      const afterCount = countText(after, "SESSION");
      assert(afterCount > before, `Expected session count to increase (was ${before}, now ${afterCount})`);
      takeScreenshot(appHandle.pid, "sessions-new-created", appHandle.windowId);
    },
  },

  {
    name: "Resume session loads the selected session",
    fn: async (appHandle) => {
      const state = await goSessions(appHandle);
      // Select a non-active session (session-1) and resume it.
      const target = await waitFor(state, { text: "Migrate to new config schema" }, 8000);
      assert(target, "Migrate to new config schema node not found");
      const fresh = freshState(appHandle);
      clickBy(appHandle.pid, fresh, { text: "Migrate to new config schema" });
      await sleep(800);
      const s = freshState(appHandle);
      // Click the detail inspector's Resume button (rightmost Resume).
      clickRightmost(appHandle.pid, s, { text: "Resume" });
      await sleep(1200);
      const after = freshState(appHandle);
      // The resumed session becomes active in the graph.
      assertTextContains(after, "SESSION-1 · active");
      takeScreenshot(appHandle.pid, "sessions-resume", appHandle.windowId);
    },
  },

  {
    name: "Fork session creates a forked copy",
    fn: async (appHandle) => {
      const state = await goSessions(appHandle);
      // Select a session and fork it via the detail inspector.
      clickBy(appHandle.pid, state, { text: "Refactor auth module" });
      await sleep(800);
      const s = freshState(appHandle);
      clickBy(appHandle.pid, s, { text: "Fork" });
      await sleep(1200);
      const after = freshState(appHandle);
      // A forked copy appears in the graph.
      assertTextContains(after, "Forked session");
      takeScreenshot(appHandle.pid, "sessions-fork", appHandle.windowId);
    },
  },

  {
    name: "Clone session creates a clone",
    fn: async (appHandle) => {
      const state = await goSessions(appHandle);
      // Select a session and clone it via the detail inspector.
      clickBy(appHandle.pid, state, { text: "Refactor auth module" });
      await sleep(800);
      const s = freshState(appHandle);
      clickBy(appHandle.pid, s, { text: "Clone" });
      await sleep(1200);
      const after = freshState(appHandle);
      // A cloned copy appears in the graph.
      assertTextContains(after, "Cloned session");
      takeScreenshot(appHandle.pid, "sessions-clone", appHandle.windowId);
    },
  },

  {
    name: "Switch session changes the active session",
    fn: async (appHandle) => {
      const state = await goSessions(appHandle);
      // Select a non-active session and switch to it.
      const target = await waitFor(state, { text: "Migrate to new config schema" }, 8000);
      assert(target, "Migrate to new config schema node not found");
      const fresh = freshState(appHandle);
      clickBy(appHandle.pid, fresh, { text: "Migrate to new config schema" });
      await sleep(800);
      const s = freshState(appHandle);
      clickBy(appHandle.pid, s, { text: "Switch" });
      await sleep(1200);
      const after = freshState(appHandle);
      // The switched-to session becomes active.
      assertTextContains(after, "SESSION-1 · active");
      takeScreenshot(appHandle.pid, "sessions-switch", appHandle.windowId);
    },
  },
];

const outcome = await runDemoSuite("Sophos Sessions cua-driver e2e", tests);

if (outcome.failed === 0) {
  console.log("\nSESSIONS TEST: PASS");
} else {
  console.log(`\nSESSIONS TEST: FAIL (${outcome.failed} failed)`);
}
