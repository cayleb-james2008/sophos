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

import { getWindowState, sleep, typeText } from "./driver.mjs";
import { navTo, takeScreenshot } from "./helpers.mjs";
import { findBy, clickBy, waitFor, clickRightmost } from "./find-util.mjs";
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
      const state = await goAgents(appHandle);
      // Click the Composition button.
      clickBy(appHandle.pid, state, { text: "Composition" });
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
