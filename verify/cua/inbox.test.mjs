// inbox.test.mjs — cua-driver e2e tests for ALL Inbox features in the Sophos
// desktop app, run in DEMO MODE (MockIpcClient) so the relay is populated with
// simulated agent messages and testable without a live daemon.
//
// Run:  node verify/cua/inbox.test.mjs
//
// The Inbox is the agent relay rendered as a message-flow graph (P9): YOU →
// message → peer agent. Each message node shows its direction (IN/OUT) and
// recency; unread incoming messages carry an UNREAD pill. This suite covers:
//   - Inbox view renders with relay messages (peers + message previews)
//   - Message flow displays sender, direction, and timestamp
//   - Mark message as read (click an unread message → read state flips)
//   - Agent switcher selects a peer and shows that peer's thread
//   - Send a relay message from the composer

import { getWindowState, getWindowStateForPixelClick, click, sleep, typeText } from "./driver.mjs";
import { takeScreenshot, getTextContent, elementCenter } from "./helpers.mjs";
import { findAll, findBy, clickBy, waitFor } from "./find-util.mjs";
import { assert, assertTextContains } from "./assertions.mjs";
import { runDemoSuite } from "./demo-runner.mjs";

/** Read a fresh window state for the app handle. */
function freshState(appHandle) {
  return getWindowState(appHandle.pid, appHandle.windowId, { include_screenshot: false });
}

/** Count occurrences of a substring in the window text content (per line). */
function countText(state, needle) {
  const content = getTextContent(state);
  return content.split("\n").filter((l) => l.includes(needle)).length;
}

function unreadDiagnostics(state) {
  const matches = /api-reviewer|test-runner|Endpoint review approved|\bUNREAD\b|\bREAD\b|unread/i;
  return {
    unreadLabels: countText(state, "UNREAD"),
    textLines: getTextContent(state).split("\n").filter((line) => matches.test(line)),
    elements: findAll(state, { text: "Endpoint review approved" })
      .map(({ role, label, frame }) => ({ role, label, frame }))
      .slice(0, 5),
  };
}

/** Navigate to the Inbox view and wait for the relay to render. */
async function goInbox(appHandle) {
  const state = freshState(appHandle);
  // The Inbox nav button carries an unread badge in its accessible name
  // (e.g. "Inbox 2"), so exact-name navTo won't match — click by substring.
  const nav = findBy(state, { role: "Button", text: "Inbox" });
  assert(nav, "Inbox nav button not found");
  clickBy(appHandle.pid, state, { role: "Button", text: "Inbox" });
  const marker = await waitFor(state, { text: "MESSAGE FLOW" }, 8000);
  assert(marker, "Inbox view did not render (MESSAGE FLOW not found)");
  // Wait for the relay graph + composer to render (a peer is auto-selected
  // without marking anything read). Do NOT click a chip here — selecting a
  // peer via its chip marks that peer's unread messages read, which the
  // mark-as-read test depends on.
  const composer = await waitFor(state, { text: "Message agent" }, 8000);
  assert(composer, "Inbox composer did not render");
  await sleep(600);
  return freshState(appHandle);
}

const tests = [
  {
    name: "Inbox view renders the relay with peers and message previews",
    fn: async (appHandle) => {
      const after = await goInbox(appHandle);
      assertTextContains(after, "MESSAGE FLOW");
      // Relay telemetry.
      assertTextContains(after, "unread");
      // Agent switcher peers (from the RLM children the fleet surfaces).
      assertTextContains(after, "api-reviewer");
      assertTextContains(after, "test-runner");
      // Message previews.
      assertTextContains(after, "Endpoint review approved");
      assertTextContains(after, "Please check the new schema");
      takeScreenshot(appHandle.pid, "inbox-render", appHandle.windowId);
    },
  },

  {
    name: "Message flow displays sender, direction, and timestamp",
    fn: async (appHandle) => {
      const after = await goInbox(appHandle);
      // Outgoing message node: "… → api-reviewer".
      assertTextContains(after, "→ api-reviewer");
      // Incoming message node: "… ← you".
      assertTextContains(after, "← you");
      // A timestamp renders alongside each message (the mono subtitle carries
      // a time string, e.g. "5:30 PM · → api-reviewer").
      const hasTime = getTextContent(after)
        .split("\n")
        .some((l) => l.includes("·") && (l.includes("→") || l.includes("←")));
      assert(hasTime, "Expected a timestamped message flow line (time · direction)");
      takeScreenshot(appHandle.pid, "inbox-flow", appHandle.windowId);
    },
  },

  {
    name: "Clicking an unread message marks it read",
    fn: async (appHandle) => {
      const state = await goInbox(appHandle);
      // The selected peer's thread has exactly one unread incoming message.
      const before = countText(state, "UNREAD");
      assert(before >= 1, `Expected an UNREAD pill before clicking (got ${before})`);
      // A prior UIA-token click was accepted but did not change the unread
      // state. Start with a fresh background pixel action; only escalate to
      // foreground after observing that no unread-state change occurred.
      takeScreenshot(appHandle.pid, "inbox-unread-before", appHandle.windowId);
      const clickState = getWindowStateForPixelClick(appHandle.pid, appHandle.windowId);
      takeScreenshot(appHandle.pid, "inbox-unread-click-state", appHandle.windowId);
      const pixelNode = findBy(clickState, { text: "Endpoint review approved" });
      assert(pixelNode, "Unread message node not found in fresh click state");
      const point = elementCenter(pixelNode, clickState);
      console.log(`[INBOX-DIAG] pre-click ${JSON.stringify({ countBefore: before, clickState: unreadDiagnostics(clickState), target: { role: pixelNode.role, label: pixelNode.label, frame: pixelNode.frame, point, screenshot: { width: clickState.screenshot_width, height: clickState.screenshot_height } } })}`);
      const backgroundResult = click(appHandle.pid, point.x, point.y, appHandle.windowId);
      console.log(`[INBOX-DIAG] background result ${JSON.stringify(backgroundResult)}`);
      await sleep(1200);
      let after = freshState(appHandle);
      let afterCount = countText(after, "UNREAD");
      takeScreenshot(appHandle.pid, "inbox-mark-read-after-background", appHandle.windowId);
      console.log(`[INBOX-DIAG] after background ${JSON.stringify(unreadDiagnostics(after))}`);
      if (afterCount >= before) {
        // This is a verified background no-op, so retry only this same click
        // with the CUA driver's foreground input rung.
        const retryState = getWindowStateForPixelClick(appHandle.pid, appHandle.windowId);
        const retryNode = findBy(retryState, { text: "Endpoint review approved" });
        assert(retryNode, "Unread message node not found in foreground retry state");
        const retryPoint = elementCenter(retryNode, retryState);
        console.log(`[INBOX-DIAG] foreground target ${JSON.stringify({ role: retryNode.role, label: retryNode.label, frame: retryNode.frame, point: retryPoint, screenshot: { width: retryState.screenshot_width, height: retryState.screenshot_height } })}`);
        const foregroundResult = click(appHandle.pid, retryPoint.x, retryPoint.y, appHandle.windowId, { delivery_mode: "foreground" });
        console.log(`[INBOX-DIAG] foreground result ${JSON.stringify(foregroundResult)}`);
        await sleep(1200);
        after = freshState(appHandle);
        afterCount = countText(after, "UNREAD");
        takeScreenshot(appHandle.pid, "inbox-mark-read-after-foreground", appHandle.windowId);
        console.log(`[INBOX-DIAG] after foreground ${JSON.stringify(unreadDiagnostics(after))}`);
      }
      // The unread pill is gone (that message flipped to read).
      assert(afterCount < before, `Expected UNREAD count to drop (was ${before}, now ${afterCount})`);
      takeScreenshot(appHandle.pid, "inbox-mark-read", appHandle.windowId);
    },
  },

  {
    name: "Agent switcher selects a peer and shows that peer's thread",
    fn: async (appHandle) => {
      const state = await goInbox(appHandle);
      // Click the test-runner chip to view its thread.
      const chip = await waitFor(state, { text: "test-runner" }, 8000);
      assert(chip, "test-runner chip not found");
      clickBy(appHandle.pid, freshState(appHandle), { text: "test-runner" });
      await sleep(1200);
      const after = freshState(appHandle);
      // test-runner's relay message now renders in the graph.
      assertTextContains(after, "Suite green on 3 targets");
      takeScreenshot(appHandle.pid, "inbox-switcher", appHandle.windowId);
    },
  },

  {
    name: "Send a relay message to the selected peer",
    fn: async (appHandle) => {
      const state = await goInbox(appHandle);
      // Find the composer textarea.
      const input = findBy(state, { role: "Edit", name: "Message agent" });
      assert(input, "Inbox composer textarea not found");
      typeText(appHandle.pid, "coordinate the next batch", appHandle.windowId, input.element_token);
      await sleep(600);
      const s2 = freshState(appHandle);
      // Click Send message.
      const sendBtn = findBy(s2, { text: "Send message" });
      assert(sendBtn, "Send message button not found");
      clickBy(appHandle.pid, s2, { text: "Send message" });
      await sleep(1200);
      const after = freshState(appHandle);
      // The sent message appears in the relay flow (local echo).
      assertTextContains(after, "coordinate the next batch");
      takeScreenshot(appHandle.pid, "inbox-send", appHandle.windowId);
    },
  },
];

const outcome = await runDemoSuite("Sophos Inbox cua-driver e2e", tests);

if (outcome.failed === 0) {
  console.log("\nINBOX TEST: PASS");
} else {
  console.log(`\nINBOX TEST: FAIL (${outcome.failed} failed)`);
}
