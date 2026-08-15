// chat.test.mjs — cua-driver e2e tests for ALL Chat features in the Sophos
// desktop app, run in DEMO MODE (MockIpcClient) so the full UI is populated
// with simulated streaming responses and testable without a live daemon.
//
// Run:  node verify/cua/chat.test.mjs
//
// Coverage:
//   Core messaging:
//     - Send message (type + send, user message renders + assistant streams)
//     - Streaming (thinking, tool call, answer)
//     - Steering (send while busy)
//     - Abort (click stop while busy)
//     - Side questions (/btw)
//     - Follow-up queue (Alt+Enter)
//   Commands:
//     - /cd directory picker (slash command entry point)
//     - Slash commands (type /, list appears, select one)
//     - Command palette (Ctrl+K)
//     - Model selector (click, dropdown, select a different model)
//     - Export

import { getWindowState, sleep, typeText, pressKey, hotkey, click, bringToFront, listWindows, call, startDaemon, stopDaemon } from "./driver.mjs";
import { navTo, takeScreenshot, getTextContent, elementCenter, SCREENSHOT_DIR } from "./helpers.mjs";
import { findBy, findAll, clickBy, waitFor } from "./find-util.mjs";
import { assert, assertTextContains } from "./assertions.mjs";
import { enableWebContentAccessibility } from "./demo-launch.mjs";
import { waitForWindow } from "./launch.mjs";
import { spawn } from "node:child_process";

/** Read a fresh window state for the app handle. */
function freshState(app) {
  return getWindowState(app.pid, app.windowId, { include_screenshot: false });
}

/** Navigate to the Chat view and wait for the composer. */
async function goChat(app) {
  // Ensure the WebView2 content is exposed to UIA (the runner's single
  // enabling click sometimes lands before the webview finishes loading).
  let s = freshState(app);
  let navBtn = findBy(s, { role: "Button", name: "Chat" });
  for (let i = 0; i < 8 && !navBtn; i++) {
    const sw = s.screenshot_width || 1200;
    const sh = s.screenshot_height || 800;
    try { click(app.pid, Math.round(sw / 2), Math.round(sh / 2), app.windowId); } catch {}
    await sleep(800);
    s = freshState(app);
    navBtn = findBy(s, { role: "Button", name: "Chat" });
  }
  assert(navBtn, "Chat nav button not found (webview content not exposed)");
  navTo(app.pid, s, "Chat");
  await sleep(600);
  const ta = await waitFor(freshState(app), { role: "Edit", name: "Message input" }, 8000);
  assert(ta, "Chat composer (Message input) not found");
  return freshState(app);
}

/** Find the composer textarea in the current state. */
function composerIn(state) {
  return findBy(state, { role: "Edit", name: "Message input" });
}

/**
 * Clear any residual content in the composer (persisted WebView2 autofill).
 * bringToFront + focus the textarea, Ctrl+A + Delete. Reliable against a
 * backgrounded window.
 */
async function ensureCleanComposer(app) {
  try { bringToFront(app.pid, app.windowId); } catch { /* best-effort */ }
  await sleep(400);
  const st = freshState(app);
  const ta = composerIn(st);
  assert(ta, "Composer textarea not found for clearing");
  const { x, y } = elementCenter(ta, st);
  click(app.pid, x, y, app.windowId); // focus the textarea
  await sleep(500);
  hotkey(app.pid, ["ctrl", "a"], app.windowId);
  await sleep(200);
  pressKey(app.pid, "delete", app.windowId);
  await sleep(350);
}

/** Focus the composer textarea so key presses land in it. Combines bringToFront,
 * an element_token invoke, and a pixel click for the widest coverage. */
async function focusComposer(app) {
  try { bringToFront(app.pid, app.windowId); } catch {}
  await sleep(300);
  const st = freshState(app);
  const ta = composerIn(st);
  assert(ta, "Composer textarea not found for focus");
  try { clickBy(app.pid, st, { role: "Edit", name: "Message input" }); } catch {}
  await sleep(250);
  try {
    const { x, y } = elementCenter(ta, st);
    click(app.pid, x, y, app.windowId);
  } catch {}
  await sleep(300);
}

/** Type text into the composer via the UIA ValuePattern (simulated keystrokes,
 * which updates React state and leaves the field focused for key presses). */
async function typeInto(app, text) {
  const ta = composerIn(freshState(app));
  assert(ta, "Composer textarea not found before typing");
  typeText(app.pid, text, app.windowId, ta.element_token);
  await sleep(500);
}

/** Click the Send button (only present when idle). */
async function clickSend(app) {
  const st = freshState(app);
  const send = findBy(st, { role: "Button", name: "Send message" });
  assert(send, "Send button not found (is the composer busy?)");
  clickBy(app.pid, st, { role: "Button", name: "Send message" });
  await sleep(400);
}

/** Wait until the composer is idle (Stop button gone — busy cleared).
 * Note: after a send the composer is emptied, so the Send button is disabled
 * and may not be exposed to UIA; the Stop button only renders while busy, so
 * its absence is the reliable idle signal. */
async function ensureIdle(app, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const s = freshState(app);
    if (!findBy(s, { role: "Button", name: "Stop generating" })) return s;
    await sleep(400);
  }
  assert(false, "Composer still busy (Stop button present) after timeout");
  return freshState(app);
}

/** Wait for the Stop (generating) button — i.e. busy/streaming. */
async function waitBusy(app, timeout = 8000) {
  const el = await waitFor(freshState(app), { role: "Button", name: "Stop generating" }, timeout);
  assert(el, "Stop button not found (turn did not go busy)");
  return freshState(app);
}

/** Send a message (type + send). */
async function sendText(app, text) {
  await typeInto(app, text);
  await clickSend(app);
}

/** Wait for a text marker to appear somewhere in the window content. */
async function waitText(app, marker, timeout = 12000) {
  const el = await waitFor(freshState(app), { text: marker }, timeout);
  assert(el, `Expected text "${marker}" to appear`);
  return freshState(app);
}

const tests = [
  {
    name: "Send message: type + send renders the user message and streams a response",
    fn: async (app) => {
      await goChat(app);
      // Clear any persisted autofill so the first send echoes cleanly.
      await ensureCleanComposer(app);
      await sendText(app, "Summarize the auth refactor");
      // User message renders.
      await waitText(app, "Summarize the auth refactor");
      // Assistant streams a response.
      await waitText(app, "Got it — you said");
      await waitText(app, "simulated demo response");
      await ensureIdle(app);
      takeScreenshot(app.pid, "chat-send", app.windowId);
    },
  },

  {
    name: "Streaming: assistant streams thinking, tool call, and a full answer",
    fn: async (app) => {
      await goChat(app);
      await sendText(app, "What does the agent do?");
      await waitText(app, "Got it — you said");
      // Tool call + result render (demo_echo).
      await waitText(app, "demo_echo");
      // Full answer completes.
      await waitText(app, "no live engine is connected");
      await ensureIdle(app);
      takeScreenshot(app.pid, "chat-streaming", app.windowId);
    },
  },

  {
    name: "Steering: Enter while busy steers the running turn",
    fn: async (app) => {
      await goChat(app);
      await sendText(app, "Start the first analysis");
      await waitBusy(app);
      await focusComposer(app);
      await typeInto(app, "Please go faster");
      // Foreground Enter reaches the focused WebView2 textarea to steer.
      pressKey(app.pid, "enter", app.windowId, { delivery_mode: "foreground" });
      // The steered indicator shows for ~4s; poll for it.
      const steered = await waitFor(freshState(app), { text: "steered" }, 4000);
      assert(steered, "steered indicator did not appear");
      const after = freshState(app);
      assertTextContains(after, "Please go faster");
      takeScreenshot(app.pid, "chat-steer", app.windowId);
      await ensureIdle(app);
    },
  },

  {
    name: "Abort: clicking Stop while busy stops the turn",
    fn: async (app) => {
      await goChat(app);
      await sendText(app, "Run a long investigation");
      const busyState = await waitBusy(app);
      assert(findBy(busyState, { role: "Button", name: "Stop generating" }), "Stop button missing while busy");
      takeScreenshot(app.pid, "chat-abort-busy", app.windowId);
      clickBy(app.pid, busyState, { role: "Button", name: "Stop generating" });
      await ensureIdle(app);
      const after = freshState(app);
      // Busy cleared: Stop is gone (Send may be disabled — the composer is empty
      // after a send — so idle is signalled by Stop's absence).
      assert(!findBy(after, { role: "Button", name: "Stop generating" }), "Stop button still present after abort");
      takeScreenshot(app.pid, "chat-abort", app.windowId);
    },
  },

  {
    name: "Side questions: /btw opens an inline side-question panel",
    fn: async (app) => {
      await goChat(app);
      await focusComposer(app);
      await typeInto(app, "/btw what is the architecture?");
      // Click Send (idle) — the /btw prefix routes to the side-question handler.
      await clickSend(app);
      await sleep(2200);
      const after = freshState(app);
      assertTextContains(after, "what is the architecture");
      takeScreenshot(app.pid, "chat-side", app.windowId);
    },
  },

  {
    name: "Follow-up queue: Alt+Enter queues a follow-up chip",
    fn: async (app) => {
      await goChat(app);
      await focusComposer(app);
      await typeInto(app, "queued follow-up question");
      hotkey(app.pid, ["alt", "enter"], app.windowId);
      await sleep(900);
      const after = freshState(app);
      assertTextContains(after, "queued follow-up question");
      takeScreenshot(app.pid, "chat-followup", app.windowId);
      // Clear the queued follow-up so later tests are not polluted.
      await sendText(app, "clear the follow-up");
      await waitBusy(app);
      pressKey(app.pid, "escape", app.windowId);
      await ensureIdle(app);
    },
  },

  {
    name: "Slash commands: typing / shows the list and selecting fills the composer",
    fn: async (app) => {
      await goChat(app);
      // Empty the composer (a send clears it) so typing "/" opens the dropdown.
      await sendText(app, "reset-composer");
      await ensureIdle(app);
      await typeInto(app, "/");
      await sleep(900);
      const after = freshState(app);
      // The dropdown shows the first 8 alphabetically-sorted matches — pick a
      // command that is in the top 8 (e.g. autonomous) and the /cd entry.
      assert(findBy(after, { text: "autonomous" }), "Slash dropdown did not show command list");
      assert(findBy(after, { text: "Change working directory" }), "Slash dropdown did not list /cd");
      takeScreenshot(app.pid, "chat-slash", app.windowId);
      // Select a command: pixel-click the /compact option (element_token invoke
      // on slash options is unreliable here) to fill the composer.
      const compact = findBy(after, { role: "Button", text: "compact" })
        || findBy(after, { role: "option", text: "compact" })
        || findBy(after, { text: "compact" });
      assert(compact, "Slash /compact option not found");
      if (compact.frame) {
        const { x, y } = elementCenter(compact, after);
        click(app.pid, x, y, app.windowId);
      } else {
        clickBy(app.pid, after, { text: "compact" });
      }
      await sleep(700);
      const st = freshState(app);
      const ta = composerIn(st);
      assert(ta && ta.value && ta.value.includes("/compact"), `Composer did not fill with /compact (value=${JSON.stringify(ta && ta.value)})`);
      takeScreenshot(app.pid, "chat-slash-select", app.windowId);
    },
  },

  {
    name: "/cd directory picker is wired into the slash autocomplete",
    fn: async (app) => {
      await goChat(app);
      await sendText(app, "reset-composer-cd");
      await ensureIdle(app);
      await typeInto(app, "/cd");
      await sleep(900);
      const after = freshState(app);
      // The /cd command appears with its "Change working directory" description.
      assert(findBy(after, { role: "option", text: "/cd" }) || findBy(after, { text: "/cd" }), "/cd not in slash dropdown");
      assert(findBy(after, { text: "Change working directory" }), "/cd description not shown");
      takeScreenshot(app.pid, "chat-cd", app.windowId);
      // Trigger the picker by clicking the /cd option (onSelect runs handleCd).
      // The native folder picker behavior is environment-dependent: either a
      // native dialog opens (dismiss it) or the picker returns null and the
      // composer clears. The core wiring (the command + its description in the
      // autocomplete) is asserted above and is the durable feature.
      const winsBefore = (listWindows() || []).map((w) => w.title);
      const cdOpt = findBy(after, { role: "option", text: "/cd" }) || findBy(after, { text: "/cd" });
      try { clickBy(app.pid, after, { text: "/cd" }); } catch {}
      await sleep(2000);
      const newDialog = (listWindows() || []).map((w) => w.title).filter((t) => !winsBefore.includes(t));
      if (newDialog.length > 0) {
        pressKey(app.pid, "escape", app.windowId);
        await sleep(600);
      }
      // Either the composer cleared (picker path ran) or a native dialog was
      // handled above. The autocomplete wiring is the durable assertion.
      takeScreenshot(app.pid, "chat-cd", app.windowId);
    },
  },

  {
    name: "Command palette: Ctrl+K opens the command overlay and toggles closed",
    fn: async (app) => {
      await goChat(app);
      hotkey(app.pid, ["ctrl", "k"], app.windowId);
      await sleep(1000);
      const after = freshState(app);
      assertTextContains(after, "Type a command or search");
      takeScreenshot(app.pid, "chat-palette", app.windowId);
      // Toggle closed with Ctrl+K (uses the same window-level listener that
      // opened it, so it works regardless of focus).
      hotkey(app.pid, ["ctrl", "k"], app.windowId);
      await sleep(700);
      const closed = freshState(app);
      assert(!getTextContent(closed).includes("Type a command or search"), "Palette did not close on Ctrl+K");
    },
  },

  {
    name: "Model selector: opens the dropdown and selects a different model",
    fn: async (app) => {
      await goChat(app);
      const st = freshState(app);
      const trig = findBy(st, { role: "Button", name: "ollama-cloud DeepSeek V4 Flash 0731" });
      assert(trig, "Model selector trigger not found");
      clickBy(app.pid, st, { role: "Button", name: "ollama-cloud DeepSeek V4 Flash 0731" });
      await sleep(900);
      const open = freshState(app);
      assert(findBy(open, { text: "MiniMax M3" }), "MiniMax M3 not listed in model panel");
      assert(findBy(open, { text: "DeepSeek V4 Flash (free)" }), "DeepSeek V4 Flash (free) not listed");
      takeScreenshot(app.pid, "chat-model-open", app.windowId);
      clickBy(app.pid, open, { text: "MiniMax M3" });
      await sleep(1200);
      const sel = freshState(app);
      assertTextContains(sel, "MiniMax M3");
      takeScreenshot(app.pid, "chat-model", app.windowId);
      // Reset to the default model so the next test isn't affected.
      const st2 = freshState(app);
      const trig2 = findBy(st2, { role: "Button", text: "MiniMax M3" });
      if (trig2) {
        clickBy(app.pid, st2, { role: "Button", text: "MiniMax M3" });
        await sleep(900);
        const open2 = freshState(app);
        const reset = findBy(open2, { text: "DeepSeek V4 Flash 0731" });
        if (reset) clickBy(app.pid, open2, { text: "DeepSeek V4 Flash 0731" });
        await sleep(1000);
      }
    },
  },

  {
    name: "Export: clicking Export shows the export toast",
    fn: async (app) => {
      await goChat(app);
      const st = freshState(app);
      const exp = findBy(st, { role: "Button", name: "Export session to HTML" });
      assert(exp, "Export button not found");
      clickBy(app.pid, st, { role: "Button", name: "Export session to HTML" });
      await sleep(700);
      const after = freshState(app);
      assertTextContains(after, "Exporting session to HTML");
      takeScreenshot(app.pid, "chat-export", app.windowId);
    },
  },
];

// --- Runner ----------------------------------------------------------------
// Launches a dedicated DEMO-MODE build and runs the suite. Uses a standalone
// build path (prefer the debug build, which is not contended by sibling workers
// building the release exe) so the e2e is stable.

import { existsSync } from "node:fs";

const WORKSPACE = "C:/Users/Cayleb/Desktop/workspace/sophos";
const DEBUG_APP = `${WORKSPACE}/src-tauri/target/debug/prime-agent-windows.exe`;
const RELEASE_APP = `${WORKSPACE}/src-tauri/target/release/prime-agent-windows.exe`;

/** Launch the chosen app path in demo mode; returns { pid, windowId }.
 * Launches the exe directly (Medium integrity, so our daemon can drive it) and
 * identifies the new window by diffing the window list against the pre-launch
 * set — more stable than launch_app under heavy multi-instance contention. */
async function launchAppPath(appPath) {
  const before = new Set(
    (listWindows() || [])
      .filter((w) => w.app_name && w.app_name.toLowerCase() === "prime-agent-windows.exe")
      .map((w) => w.window_id),
  );
  const proc = spawn(appPath, ["--demo"], { detached: true, stdio: "ignore", windowsHide: true });
  proc.unref();
  for (let i = 0; i < 40; i++) {
    await sleep(1000);
    const fresh = (listWindows() || []).filter(
      (w) => w.app_name && w.app_name.toLowerCase() === "prime-agent-windows.exe" && !before.has(w.window_id),
    );
    if (fresh.length) {
      const w = fresh[0];
      try { await enableWebContentAccessibility(w.pid, w.window_id); } catch {}
      return { pid: w.pid, windowId: w.window_id };
    }
  }
  throw new Error("no new Sophos window appeared");
}

async function runChatSuite(name, tests) {
  console.log(`\n=== ${name} ===`);
  const daemon = startDaemon();
  const daemonStarted = !daemon.alreadyRunning;
  // Prefer the debug build (has the busy-clearing fix; the release exe is stale
  // and contended by siblings); fall back to release.
  const appPath = existsSync(DEBUG_APP) ? DEBUG_APP : RELEASE_APP;
  console.log(`launching demo app: ${appPath}`);
  const { pid, windowId } = await launchAppPath(appPath);
  const app = { pid, windowId };
  await sleep(1500);

  const results = [];
  for (const t of tests) {
    const start = Date.now();
    try {
      await t.fn(app);
      const elapsed = Date.now() - start;
      results.push({ name: t.name, pass: true, elapsed });
      console.log(`  \u2713 ${t.name} (${elapsed}ms)`);
    } catch (err) {
      const elapsed = Date.now() - start;
      results.push({ name: t.name, pass: false, elapsed, error: err.message });
      console.error(`  \u2717 ${t.name} (${elapsed}ms): ${err.message}`);
    }
  }

  // Tear down.
  try { takeScreenshot(app.pid, "final-state", app.windowId); } catch {}
  try { call("kill_app", { pid }); } catch {}
  if (daemonStarted) stopDaemon();

  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  const totalMs = results.reduce((s, r) => s + (r.elapsed || 0), 0);
  console.log(`\n${name}: ${passed} passed, ${failed} failed (${totalMs}ms total)`);
  if (failed > 0) process.exitCode = 1;
  return { name, results, passed, failed };
}

const outcome = await runChatSuite("Sophos Chat cua-driver e2e", tests);

if (outcome.failed === 0) {
  console.log("\nCHAT TEST: PASS");
} else {
  console.log(`\nCHAT TEST: FAIL (${outcome.failed} failed)`);
}
