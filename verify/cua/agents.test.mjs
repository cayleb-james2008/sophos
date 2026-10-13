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
import { navTo, takeScreenshot, elementCenter, toWindowLocal } from "./helpers.mjs";
import {
  findBy,
  clickBy,
  waitFor,
  clickRightmost,
  findNamedRegionDescendantElement,
  findNamedRegionScrollElement,
} from "./find-util.mjs";
import { assert, assertTextContains, assertElementNotVisible } from "./assertions.mjs";
import { runDemoSuite } from "./demo-runner.mjs";
import { composerBoundsFromElements, frameWithinVerticalBounds } from "./thread-visibility.mjs";

/** Read a fresh window state for the app handle. */
function freshState(appHandle) {
  return getWindowState(appHandle.pid, appHandle.windowId, { include_screenshot: false });
}

function centerIsInScreenshot(element, state) {
  if (!element || !Number.isFinite(state.screenshot_width) || !Number.isFinite(state.screenshot_height)) return false;
  const center = elementCenter(element, state);
  return center.x >= 0 && center.y >= 0
    && center.x < state.screenshot_width && center.y < state.screenshot_height;
}

function frameIsFullyInScreenshot(element, state) {
  const frame = element?.frame;
  if (!frame || ![frame.x, frame.y, frame.w, frame.h].every(Number.isFinite) || frame.w <= 0 || frame.h <= 0) {
    return false;
  }
  const topLeft = toWindowLocal(frame.x, frame.y, state);
  const bottomRight = toWindowLocal(frame.x + frame.w, frame.y + frame.h, state);
  return topLeft.x >= 0 && topLeft.y >= 0
    && bottomRight.x <= state.screenshot_width && bottomRight.y <= state.screenshot_height;
}

async function waitForCenterInScreenshot(appHandle, criteria, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = getWindowState(appHandle.pid, appHandle.windowId, { include_screenshot: true });
    const element = findBy(state, criteria);
    if (centerIsInScreenshot(element, state)) return { state, element };
    await sleep(250);
  }
  return null;
}

function findVisibleThreadMessage(state) {
  // WebView2 can keep clipped descendants in the UIA tree with frame bounds
  // that are still inside the overall window. Bound visibility to the actual
  // thread slot, between its header and the following composer.
  const header = findNamedRegionDescendantElement(state, "Agent coordination thread", { role: "Text", text: "THREAD /" });
  const composer = composerBoundsFromElements(state.elements);
  const threadTop = header?.frame
    ? Number(header.frame.y) + Number(header.frame.h)
    : Number.NaN;
  const composerTop = composer?.top;
  const candidates = ["Please check the new schema", "Endpoint review approved"].map((text) => ({
    text,
    element: findNamedRegionDescendantElement(state, "Agent coordination thread", { role: "Text", text }),
  }));
  const insideThreadViewport = (frame) => frameWithinVerticalBounds(frame, threadTop, composerTop);
  const visible = candidates.find(({ element }) => {
    return frameIsFullyInScreenshot(element, state) && insideThreadViewport(element?.frame);
  });
  console.log("[AGENT-COMPOSITION-THREAD-MESSAGE-CANDIDATES]", JSON.stringify({
    threadTop,
    composerTop,
    composerLabelFrame: composer?.messageLabel?.frame ?? null,
    sendButton: composer?.sendButton ? {
      role: composer.sendButton.role,
      frame: composer.sendButton.frame,
    } : null,
    candidates: candidates.map(({ text, element }) => ({
      text,
      frame: element?.frame,
      fullyInScreenshot: frameIsFullyInScreenshot(element, state),
      insideThreadViewport: insideThreadViewport(element?.frame),
    })),
    visible: visible?.text ?? null,
  }));
  return visible?.element;
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
    name: "Composition controls stay visible and open the thinking + skills panel",
    fn: async (appHandle) => {
      await goAgents(appHandle);
      // Leave an actionable draft in the composer. The native UIA provider
      // omits bounds for the disabled Send button, so enable it before
      // asserting that the expanded composition panel keeps the control in
      // the visible window.
      const initial = freshState(appHandle);
      const input = findBy(initial, { role: "Edit", name: "Message to api-reviewer" });
      assert(input, "Message input not found before opening composition controls");
      typeText(appHandle.pid, "composition visibility check", appHandle.windowId, input.element_token);
      await sleep(800);
      // Keep the composer outside the thread's scroll viewport so its controls
      // remain available when the selected agent's thread is taller than the window.
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
        compositionBefore && frameIsFullyInScreenshot(compositionBefore, scrollState),
        "Composition control must remain fully visible without scrolling the Agent coordination thread",
      );
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
      assert(
        typeof scrollTarget.element_token === "string" && scrollTarget.element_token.length > 0,
        "Agent coordination thread scroll target has no native element token",
      );
      console.log("[AGENT-COMPOSITION-UIA-SCROLL]", JSON.stringify({
        actionTarget: {
          element_index: scrollTarget.element_index,
          role: scrollTarget.role,
          frame: scrollTarget.frame,
        },
      }));
      const scrollResult = scroll(appHandle.pid, "down", 1, appHandle.windowId, {
        element_token: scrollTarget.element_token,
      });
      console.log("[AGENT-COMPOSITION-UIA-SCROLL-RESULT]", JSON.stringify({
        requested: {
          direction: "down",
          amount: 1,
          target_element_index: scrollTarget.element_index,
          route: "uia_scroll_pattern",
        },
        result: scrollResult,
      }));
      await sleep(350);
      let visibleComposition = await waitForCenterInScreenshot(appHandle, { text: "Composition" }, 1500);
      if (!visibleComposition) {
        // The nested HTML region can be an unindexed UIA Group. In that case
        // the only indexed ScrollPattern may belong to the WebView Document,
        // so retain an in-region foreground-wheel fallback and verify it from
        // a fresh native snapshot rather than assuming the Document moved it.
        const fallbackState = getWindowState(appHandle.pid, appHandle.windowId, { include_screenshot: true });
        const pointerTarget = findNamedRegionDescendantElement(
          fallbackState,
          "Agent coordination thread",
          { role: "Text", text: "THREAD /" },
        );
        assert(pointerTarget, "Agent coordination thread has no indexed in-region fallback pointer target");
        const scrollPoint = elementCenter(pointerTarget, fallbackState);
        assert(
          scrollPoint.x >= 0 && scrollPoint.y >= 0 &&
            scrollPoint.x < fallbackState.screenshot_width && scrollPoint.y < fallbackState.screenshot_height,
          `Agent coordination thread fallback target is outside the window (${scrollPoint.x}, ${scrollPoint.y})`,
        );
        const fallbackResult = scroll(appHandle.pid, "down", 5, appHandle.windowId, {
          x: scrollPoint.x,
          y: scrollPoint.y,
          delivery_mode: "foreground",
        });
        console.log("[AGENT-COMPOSITION-UIA-SCROLL-FALLBACK]", JSON.stringify({
          target_element_index: pointerTarget.element_index,
          point: scrollPoint,
          result: fallbackResult,
        }));
        await sleep(350);
        visibleComposition = await waitForCenterInScreenshot(appHandle, { text: "Composition" }, 8000);
      }
      takeScreenshot(appHandle.pid, "agents-composition-control-after-scroll", appHandle.windowId);
      assert(visibleComposition, "Composition control became hidden while the Agent coordination thread scrolled");
      const ready = getWindowState(appHandle.pid, appHandle.windowId, { include_screenshot: true });
      const composition = findBy(ready, { text: "Composition" });
      const buttonCenter = composition ? elementCenter(composition, ready) : null;
      console.log("[AGENT-COMPOSITION-UIA-AFTER-SCROLL]", JSON.stringify({
        screenshot: `${ready.screenshot_width}x${ready.screenshot_height}`,
        elementCount: (ready.elements ?? []).length,
        composition: composition ? {
          element_index: composition.element_index,
          role: composition.role,
          frame: composition.frame,
          center: buttonCenter,
        } : null,
      }));
      assert(composition, "Composition control disappeared from the fresh native UIA snapshot");
      assert(centerIsInScreenshot(composition, ready),
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
      const expanded = getWindowState(appHandle.pid, appHandle.windowId, { include_screenshot: true });
      const sendControl = findBy(expanded, { role: "Button", text: "Send" });
      console.log("[AGENT-COMPOSITION-SEND-BOUNDS]", JSON.stringify({
        screenshot: `${expanded.screenshot_width}x${expanded.screenshot_height}`,
        send: sendControl ? { role: sendControl.role, frame: sendControl.frame } : null,
      }));
      if (!sendControl) console.log("[AGENT-COMPOSITION-EXPANDED-COMPOSER-TREE]", expanded.tree_markdown ?? "<tree missing>");
      assert(expanded.screenshot_height > 680, "Expanded-composer bounds require a window taller than the short-window fallback threshold");
      const compositionExpanded = findBy(expanded, { text: "Composition" });
      assert(
        compositionExpanded && frameIsFullyInScreenshot(compositionExpanded, expanded),
        "The full Composition control must remain on-screen when the panel is expanded",
      );
      assert(
        sendControl && frameIsFullyInScreenshot(sendControl, expanded),
        "The full Send button must remain on-screen when the composition panel is expanded",
      );
      const initiallyVisibleMessage = findVisibleThreadMessage(expanded);
      if (!initiallyVisibleMessage) {
        console.log("[AGENT-COMPOSITION-EXPANDED-THREAD-TREE]", expanded.tree_markdown ?? "<tree missing>");
      }
      assert(
        initiallyVisibleMessage,
        "At least one coordination-thread message must be readable immediately with Composition expanded",
      );
      const messagePoint = elementCenter(initiallyVisibleMessage, expanded);
      assert(
        messagePoint.x >= 0 && messagePoint.y >= 0
          && messagePoint.x < expanded.screenshot_width && messagePoint.y < expanded.screenshot_height,
        `Visible coordination message is outside the screenshot (${messagePoint.x}, ${messagePoint.y})`,
      );
      takeScreenshot(appHandle.pid, "agents-composition-expanded-before-thread-scroll", appHandle.windowId);
      // Screenshot capture obtains a fresh native UIA snapshot; the element
      // tokens from `expanded` are now stale and must not be used for actions.
      let afterExpandedScroll = getWindowState(appHandle.pid, appHandle.windowId, { include_screenshot: true });
      let sameMessageAfterScroll;
      let messageFrameShift = 0;
      const scrollAttempts = [];
      for (const direction of ["down", "up"]) {
        const currentState = afterExpandedScroll;
        const currentMessage = scrollAttempts.length === 0
          ? initiallyVisibleMessage
          : findNamedRegionDescendantElement(
            currentState,
            "Agent coordination thread",
            { role: "Text", text: initiallyVisibleMessage.label },
          );
        assert(currentMessage, "The coordination message disappeared before the reverse scroll check");
        const threadScrollTarget = findNamedRegionScrollElement(
          currentState,
          "Agent coordination messages",
          { allowAncestors: false },
        );
        if (!threadScrollTarget) {
          console.log("[AGENT-COMPOSITION-MESSAGE-SCROLL-TREE]", currentState.tree_markdown ?? "<tree missing>");
        }
        let actionTarget;
        let result;
        if (threadScrollTarget) {
          assert(
            typeof threadScrollTarget.element_token === "string" && threadScrollTarget.element_token.length > 0,
            "Agent coordination messages native ScrollPattern target has no element token",
          );
          actionTarget = {
            route: "uia_scroll_pattern",
            element_index: threadScrollTarget.element_index,
            role: threadScrollTarget.role,
            frame: threadScrollTarget.frame,
          };
          result = scroll(appHandle.pid, direction, 1, appHandle.windowId, {
            element_token: threadScrollTarget.element_token,
          });
        } else {
          const header = findNamedRegionDescendantElement(currentState, "Agent coordination thread", {
            role: "Text",
            text: "THREAD /",
          });
          const composer = composerBoundsFromElements(currentState.elements);
          const threadTop = header?.frame
            ? Number(header.frame.y) + Number(header.frame.h)
            : Number.NaN;
          assert(
            frameWithinVerticalBounds(currentMessage.frame, threadTop, composer?.top),
            "Foreground wheel fallback requires a message fully inside the thread viewport",
          );
          const point = elementCenter(currentMessage, currentState);
          assert(
            point.x >= 0 && point.y >= 0
              && point.x < currentState.screenshot_width
              && point.y < currentState.screenshot_height,
            `Thread message wheel target is outside the screenshot (${point.x}, ${point.y})`,
          );
          actionTarget = {
            route: "foreground_wheel_inside_message",
            point,
            messageFrame: currentMessage.frame,
          };
          result = scroll(appHandle.pid, direction, 1, appHandle.windowId, {
            x: point.x,
            y: point.y,
            delivery_mode: "foreground",
          });
        }
        await sleep(350);
        afterExpandedScroll = getWindowState(appHandle.pid, appHandle.windowId, { include_screenshot: true });
        sameMessageAfterScroll = findNamedRegionDescendantElement(
          afterExpandedScroll,
          "Agent coordination thread",
          { role: "Text", text: initiallyVisibleMessage.label },
        );
        assert(sameMessageAfterScroll, "The coordination message disappeared from the native tree after scrolling");
        messageFrameShift = Number(sameMessageAfterScroll.frame?.y) - Number(initiallyVisibleMessage.frame?.y);
        scrollAttempts.push({
          direction,
          target: actionTarget,
          result,
          frame: sameMessageAfterScroll.frame,
          frameShift: messageFrameShift,
        });
        if (Math.abs(messageFrameShift) >= 1) break;
      }
      console.log("[AGENT-COMPOSITION-EXPANDED-THREAD-SCROLL]", JSON.stringify({
        message: initiallyVisibleMessage.label,
        initialFrame: initiallyVisibleMessage.frame,
        attempts: scrollAttempts,
        finalFrame: sameMessageAfterScroll?.frame,
      }));
      takeScreenshot(appHandle.pid, "agents-composition-expanded-thread-scroll-attempt", appHandle.windowId);
      assert(
        Number.isFinite(messageFrameShift) && Math.abs(messageFrameShift) >= 1,
        "Scrolling the expanded coordination thread in either direction must move its message content",
      );
      const visibleMessageAfterScroll = findVisibleThreadMessage(afterExpandedScroll);
      const compositionAfterScroll = findBy(afterExpandedScroll, { text: "Composition" });
      const sendAfterScroll = findBy(afterExpandedScroll, { role: "Button", text: "Send" });
      assert(visibleMessageAfterScroll, "A coordination-thread message must remain readable after scrolling");
      assert(
        compositionAfterScroll && frameIsFullyInScreenshot(compositionAfterScroll, afterExpandedScroll),
        "Composition must remain fully visible while the expanded coordination thread scrolls",
      );
      assert(
        sendAfterScroll && frameIsFullyInScreenshot(sendAfterScroll, afterExpandedScroll),
        "Send must remain fully visible while the expanded coordination thread scrolls",
      );
      takeScreenshot(appHandle.pid, "agents-composition-expanded-thread-scroll", appHandle.windowId);
    },
  },
];

const outcome = await runDemoSuite("Sophos Agents cua-driver e2e", tests);

if (outcome.failed === 0) {
  console.log("\nAGENTS TEST: PASS");
} else {
  console.log(`\nAGENTS TEST: FAIL (${outcome.failed} failed)`);
}
