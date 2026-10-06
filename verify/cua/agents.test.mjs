// agents.test.mjs — cua-driver e2e tests for ALL Agents features in the
// Sophos desktop app, run in DEMO MODE (MockIpcClient) so the fleet graph is
// populated with simulated agents and testable without a live daemon.
//
// Run:  node verify/cua/agents.test.mjs
//
// Coverage:
//   - Fleet graph renders (operator, daemon, RLM children)
//   - RLM children are shown in the graph
//   - Attach agent
//   - Detach agent
//   - Send message to agent
//   - Composition knobs (thinking level + skills)

import { getWindowState, sleep, typeText, scroll } from "./driver.mjs";
import { navTo, takeScreenshot, elementCenter } from "./helpers.mjs";
import { findBy, clickBy, waitFor, clickRightmost, findNamedRegionScrollElement } from "./find-util.mjs";
import { assert, assertTextContains, assertElementNotVisible } from "./assertions.mjs";
import { runDemoSuite } from "./demo-runner.mjs";

/** Read a fresh window state for the app handle. */
function freshState(appHandle) {
  return getWindowState(appHandle.pid, appHandle.windowId, { include_screenshot: false });
}

/** Navigate to the Agents view and wait for it to render. */
async function goAgents(appHandle) {
  // Navigate to Chat first so AgentsView remounts (resets attach state).
  const state = freshState(appHandle);
  navTo(appHandle.pid, state, "Chat");
  await sleep(400);
  const s2 = freshState(appHandle);
  navTo(appHandle.pid, s2, "Agents");
  const marker = await waitFor(s2, { text: "AGENT FLEET" }, 8000);
  assert(marker, "Agents view did not render (AGENT FLEET not found)");
  await sleep(800);
  return freshState(appHandle);
}

const tests = [
  {
    name: "Agents fleet graph renders operator, daemon, and RLM children",
    fn: async (appHandle) => {
      const after = await goAgents(appHandle);
      assertTextContains(after, "AGENT FLEET");
      // Root + relay nodes.
      assertTextContains(after, "Operator");
      assertTextContains(after, "Daemon");
      // RLM child nodes.
      assertTextContains(after, "RLM CHILD");
      // Graph edges.
      assertTextContains(after, "Edge from operator to daemon");
      assertTextContains(after, "Edge from daemon to rlm-1");
      takeScreenshot(appHandle.pid, "agents-fleet", appHandle.windowId);
    },
  },

  {
    name: "RLM children are shown in the fleet graph",
    fn: async (appHandle) => {
      const after = await goAgents(appHandle);
      // RLM child nodes render with their summaries (names render as initials).
      assertTextContains(after, "Reviewing endpoint contracts");
      assertTextContains(after, "Awaiting next batch");
      // The selected agent's detail shows its RLM status.
      assertTextContains(after, "RLM SUBAGENT");
      takeScreenshot(appHandle.pid, "agents-rlm", appHandle.windowId);
    },
  },

  {
    name: "Attach agent attaches the selected agent",
    fn: async (appHandle) => {
      const state = await goAgents(appHandle);
      // Click the detail inspector's Attach (rightmost) for the selected agent.
      clickRightmost(appHandle.pid, state, { text: "Attach" });
      await sleep(1200);
      const after = freshState(appHandle);
      // The selected agent is now attached → the detail shows Detach.
      assertTextContains(after, "Detach");
      takeScreenshot(appHandle.pid, "agents-attach", appHandle.windowId);
    },
  },

  {
    name: "Detach agent detaches the selected agent",
    fn: async (appHandle) => {
      const state = await goAgents(appHandle);
      // Attach first (detail inspector's Attach).
      clickRightmost(appHandle.pid, state, { text: "Attach" });
      await sleep(1000);
      const s2 = freshState(appHandle);
      // Now detach (detail inspector's Detach).
      clickRightmost(appHandle.pid, s2, { text: "Detach" });
      await sleep(1200);
      const after = freshState(appHandle);
      // After detach, no Detach button remains (the agent is unattached).
      assert(!findBy(after, { text: "Detach" }), "Detach button still present after detach");
      takeScreenshot(appHandle.pid, "agents-detach", appHandle.windowId);
    },
  },

  {
    name: "Send message to agent types into the composer and Send is present",
    fn: async (appHandle) => {
      const state = await goAgents(appHandle);
      // Find the message input for the selected agent.
      const input = findBy(state, { role: "Edit", name: "Message to api-reviewer" });
      assert(input, "Message input not found");
      // Type a message into the input (UIA ValuePattern sets the value).
      typeText(appHandle.pid, "hello agent, run the tests", appHandle.windowId, input.element_token);
      await sleep(800);
      const after = freshState(appHandle);
      // The typed text is present in the composer (typing round-trips).
      const inputAfter = findBy(after, { role: "Edit", name: "Message to api-reviewer" });
      assert(inputAfter && inputAfter.value && inputAfter.value.includes("hello agent"), "Typed text did not reach the composer");
      // The Send control is present.
      assert(findBy(after, { text: "Send" }), "Send button not found");
      takeScreenshot(appHandle.pid, "agents-send", appHandle.windowId);
    },
  },

  {
    name: "Composition knobs open the thinking + skills panel",
    fn: async (appHandle) => {
      await goAgents(appHandle);
      // Resolve the native scroll path for the named thread from this same
      // snapshot. WebView2 may expose the thread as an unindexed Group with no
      // scroll action; then its nearest indexed scrollable ancestor is the
      // actionable path to bring the off-screen composition control into view.
      const scrollState = getWindowState(appHandle.pid, appHandle.windowId, { include_screenshot: true });
      const nativeTree = String(scrollState.tree_markdown ?? "");
      const compositionBefore = findBy(scrollState, { text: "Composition" });
      const nativeScrollTargets = (scrollState.elements ?? [])
        .filter((element) => Array.isArray(element.actions) && element.actions.includes("scroll"))
        .map(({ element_index, role, frame }) => ({ element_index, role, frame }));
      console.log("[AGENT-COMPOSITION-UIA-SNAPSHOT]", JSON.stringify({
        screenshot: `${scrollState.screenshot_width}x${scrollState.screenshot_height}`,
        elementCount: (scrollState.elements ?? []).length,
        nativeScrollTargets,
        composition: compositionBefore ? {
          element_index: compositionBefore.element_index,
          role: compositionBefore.role,
          frame: compositionBefore.frame,
        } : null,
      }));
      assert(
        nativeTree.split(/\r?\n/).some((line) =>
          /^\s*-\s+(?:\[\d+\]\s+)?(?:Group|Pane|Region)\s+"Agent coordination thread"(?:\s|$)/.test(line),
        ),
        "Agent coordination thread region is missing from the native UIA tree",
      );
      const scrollTarget = findNamedRegionScrollElement(scrollState, "Agent coordination thread");
      if (!scrollTarget) console.log("[AGENT-COMPOSITION-UIA-TREE]", scrollState.tree_markdown ?? "<tree missing>");
      assert(scrollTarget, "Agent coordination thread has no indexed scroll target in its native tree path");
      console.log("[AGENT-COMPOSITION-UIA-RESOLVED]", JSON.stringify({
        element_index: scrollTarget.element_index,
        role: scrollTarget.role,
        frame: scrollTarget.frame,
      }));
      assert(
        Number(scrollTarget.frame?.w) > 0 && Number(scrollTarget.frame?.h) > 0,
        "Agent coordination thread scroll target has no native bounds",
      );
      const scrollPoint = elementCenter(scrollTarget, scrollState);
      assert(
        scrollPoint.x >= 0 && scrollPoint.y >= 0 &&
          scrollPoint.x < scrollState.screenshot_width && scrollPoint.y < scrollState.screenshot_height,
        `Agent coordination thread scroll target is outside the window (${scrollPoint.x}, ${scrollPoint.y})`,
      );
      scroll(appHandle.pid, "down", 5, appHandle.windowId, { x: scrollPoint.x, y: scrollPoint.y });
      await sleep(350);
      takeScreenshot(appHandle.pid, "agents-composition-control-visible", appHandle.windowId);

      const scrolled = await waitFor(scrollState, { text: "Composition" }, 8000);
      assert(scrolled, "Composition control did not appear after scrolling the Agent coordination thread");
      const ready = getWindowState(appHandle.pid, appHandle.windowId, { include_screenshot: true });
      const composition = findBy(ready, { text: "Composition" });
      assert(composition, "Composition control disappeared from the fresh native UIA snapshot");
      const buttonCenter = elementCenter(composition, ready);
      assert(
        buttonCenter.x >= 0 && buttonCenter.y >= 0 &&
          buttonCenter.x < ready.screenshot_width && buttonCenter.y < ready.screenshot_height,
        `Composition control is outside the window after scrolling (${buttonCenter.x}, ${buttonCenter.y})`,
      );
      console.log("[AGENT-COMPOSITION-UIA]", JSON.stringify({
        scrollTarget: {
          element_index: scrollTarget.element_index,
          role: scrollTarget.role,
          label: scrollTarget.label,
          frame: scrollTarget.frame,
        },
        composition: {
          element_index: composition.element_index,
          role: composition.role,
          label: composition.label,
          frame: composition.frame,
        },
        screenshot: `${ready.screenshot_width}x${ready.screenshot_height}`,
      }));
      // Click the visible native Composition control.
      clickBy(appHandle.pid, ready, { text: "Composition" });
      await sleep(800);
      const after = freshState(appHandle);
      // The composition panel shows thinking level + skills (case-insensitive
      // find: the labels render uppercase via CSS).
      assert(findBy(after, { text: "thinking" }), "Thinking level control not shown");
      assert(findBy(after, { text: "skill" }), "Skills control not shown");
      takeScreenshot(appHandle.pid, "agents-composition", appHandle.windowId);
    },
  },
];

const outcome = await runDemoSuite("Sophos Agents cua-driver e2e", tests);

if (outcome.failed === 0) {
  console.log("\nAGENTS TEST: PASS");
} else {
  console.log(`\nAGENTS TEST: FAIL (${outcome.failed} failed)`);
}
