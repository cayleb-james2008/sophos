// studio.test.mjs — cua-driver e2e tests for the Profile Studio (v0.7.1) in
// the Sophos desktop app, run in DEMO MODE (MockIpcClient) against the real
// Tauri release build.
//
// Run:  node verify/cua/studio.test.mjs
//
// Coverage:
//   - The studio opens from the header profile chip (Profile → Profile Studio).
//   - A custom profile is created, becomes active immediately (hot reload),
//     and demo responses follow its draft (name/tagline/working-style flavor).
//   - Editing hot-reloads while the drawer is open; Save persists; Discard
//     reverts; Delete removes and falls back to Standard defaults.
//   - The picker lists custom profiles in a "Custom" section beside the five
//     built-ins, and the selection + store survive an app restart.
//
// The lifecycle is self-contained (mirrors shell.test.mjs) because the
// restart-persistence test must close and relaunch the app, and the suite
// clears WebView2 localStorage on first launch so prior runs' profiles never
// leak into the assertions.

import { existsSync, readFileSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import {
  startDaemon,
  stopDaemon,
  sleep,
  getWindowState,
  clickElement,
  typeText,
  bringToFront,
  click,
  listWindows,
  call,
} from "./driver.mjs";
import { closeApp } from "./launch.mjs";
import { launchDemoApp } from "./demo-launch.mjs";
import { getTextContent, takeScreenshot, elementCenter } from "./helpers.mjs";
import { findBy, clickBy, waitFor } from "./find-util.mjs";
import { assert } from "./assertions.mjs";

const LOCAL_STORAGE_DIR =
  process.env.LOCALAPPDATA + "/com.sophos.app/EBWebView/Default/Local Storage";

const app = { pid: null, windowId: null };
let daemonStartedByRunner = false;

function freshState() {
  if (!app.pid) throw new Error("No app handle (suite not launched)");
  try {
    return getWindowState(app.pid, app.windowId, { include_screenshot: false });
  } catch {
    try {
      return getWindowState(app.pid, app.windowId, { include_screenshot: false });
    } catch {
      const mine = listWindows({ pid: app.pid });
      if (mine.length) {
        app.windowId = mine[0].window_id;
        return getWindowState(app.pid, app.windowId, { include_screenshot: false });
      }
      throw new Error("app instance replaced by a concurrent worker");
    }
  }
}

/** Case-insensitive substring assertion against the window's text content. */
function assertText(state, text) {
  const content = getTextContent(state).toLowerCase();
  const needle = String(text).toLowerCase();
  assert(content.includes(needle), `Expected text "${text}" in window content. Got:\n${content.slice(0, 2500)}`);
}

async function killLingeringInstances() {
  for (const w of listWindows()) {
    if (w.app_name && w.app_name.toLowerCase().includes("prime-agent")) {
      try { call("kill_app", { pid: w.pid }); } catch { /* already gone */ }
    }
  }
  await sleep(1500);
  try {
    const ps =
      "$roots=Get-CimInstance Win32_Process|Where-Object{$_.Name -eq 'prime-agent-windows.exe'};" +
      "foreach($p in $roots){Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue};" +
      "Get-CimInstance Win32_Process|Where-Object{$_.Name -eq 'msedgewebview2.exe'}|ForEach-Object{" +
      "$pp=$_.ParentProcessId;$isChild=$false;" +
      "for($i=0;$i -lt 8 -and $pp;$i++){$par=Get-CimInstance Win32_Process -Filter \"ProcessId=$pp\" -ErrorAction SilentlyContinue;if(-not $par){break};if($par.Name -eq 'prime-agent-windows.exe'){$isChild=$true;break};$pp=$par.ParentProcessId};" +
      "if($isChild){Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue}}";
    execSync(`powershell -NoProfile -Command "${ps}"`, { timeout: 30000 });
  } catch { /* best-effort */ }
  await sleep(2000);
}

function clearLocalStorage() {
  try {
    if (existsSync(LOCAL_STORAGE_DIR)) {
      rmSync(LOCAL_STORAGE_DIR, { recursive: true, force: true });
    }
  } catch {
    // Best-effort — if a process holds the lock we continue with existing state.
  }
}

async function launch() {
  await killLingeringInstances();
  clearLocalStorage();
  return relaunch();
}

async function relaunch() {
  await killLingeringInstances();
  const launched = await launchDemoApp();
  app.pid = launched.pid;
  app.windowId = launched.windowId;
  await sleep(1500);
  return app;
}

async function beforeAll() {
  const daemon = startDaemon();
  daemonStartedByRunner = !daemon.alreadyRunning;
  await launch();
}

async function afterAll() {
  try { takeScreenshot(app.pid, "studio-final", app.windowId); } catch {}
  try { closeApp(app.pid); } catch {}
  app.pid = null;
  app.windowId = null;
  await killLingeringInstances();
  if (daemonStartedByRunner) {
    stopDaemon();
    daemonStartedByRunner = false;
  }
}

// ---------------------------------------------------------------------------
// Studio helpers
// ---------------------------------------------------------------------------

/** Close the studio drawer if it is open (uses the ✕ / Discard close). */
async function closeStudioIfOpen() {
  if (!findBy(freshState(), { text: "Profile Studio" })) return;
  const close = findBy(freshState(), { text: "✕" }) ?? findBy(freshState(), { role: "Button", text: "Discard" });
  if (close && close.element_token) {
    clickElement(app.pid, app.windowId, close.element_token);
    await sleep(600);
  }
}

/** Open the profile picker from the header chip (its button label contains
 * the active profile name, e.g. "Standard"). Idempotent: if the panel is
 * already open it is not toggled closed. */
async function openProfilePicker() {
  await closeStudioIfOpen();
  // The WebView2 content must be exposed to UIA first.
  let s = freshState();
  let trigger = findBy(s, { role: "Button", text: "Profile" });
  for (let i = 0; i < 8 && !trigger; i++) {
    const sw = s.screenshot_width || 1200;
    const sh = s.screenshot_height || 800;
    try { click(app.pid, Math.round(sw / 2), Math.round(sh / 2), app.windowId); } catch {}
    await sleep(800);
    s = freshState();
    trigger = findBy(s, { role: "Button", text: "Profile" });
  }
  assert(trigger, "Profile chip (header trigger) not found");
  if (findBy(s, { text: "Agent profile" })) return s; // already open
  clickBy(app.pid, s, { role: "Button", text: "Profile" });
  await sleep(600);
  let panel = await waitFor(freshState(), { text: "Agent profile" }, 8000);
  if (!panel) {
    // The first click may have toggled it closed (race) — click again.
    clickBy(app.pid, freshState(), { role: "Button", text: "Profile" });
    panel = await waitFor(freshState(), { text: "Agent profile" }, 8000);
  }
  assert(panel, "Profile picker panel did not open");
  return freshState();
}

/** Open the Profile Studio drawer from the picker. */
async function openStudioFromPicker() {
  await openProfilePicker();
  const entry = await waitFor(freshState(), { text: "Profile Studio — build your own" }, 8000);
  assert(entry, "Profile Studio entry not found in the picker");
  clickBy(app.pid, freshState(), { text: "Profile Studio — build your own" });
  const studio = await waitFor(freshState(), { text: "Profile Studio" }, 8000);
  assert(studio, "Profile Studio drawer did not open");
  await sleep(600);
  return freshState();
}

/** Focus + type into a studio field by its accessible label. */
async function typeIntoField(pid, windowId, label, text) {
  const st = freshState();
  const field = findBy(st, { role: "Edit", name: label });
  assert(field, `Studio field "${label}" not found`);
  try { clickBy(pid, st, { role: "Edit", name: label }); } catch {}
  await sleep(300);
  typeText(pid, text, windowId, field.element_token);
  await sleep(500);
}

/** Toggle a registry tool by its accessible label (WebView2 exposes the
 * role=switch buttons as plain Buttons, e.g. "shell BUILT-IN"). */
async function toggleTool(pid, windowId, label) {
  const st = freshState();
  const tool = findBy(st, { text: label });
  assert(tool, `Tool toggle "${label}" not found in the studio`);
  clickBy(pid, st, { text: label });
  await sleep(500);
}

// ---------------------------------------------------------------------------
// Chat helpers (mirror chat.test.mjs — focus + type + send + wait)
// ---------------------------------------------------------------------------

function composerIn(state) {
  return findBy(state, { role: "Edit", name: "Message input" });
}

async function focusComposer() {
  try { bringToFront(app.pid, app.windowId); } catch {}
  await sleep(300);
  const st = freshState();
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

async function typeInto(text) {
  const ta = composerIn(freshState());
  assert(ta, "Composer textarea not found before typing");
  typeText(app.pid, text, app.windowId, ta.element_token);
  await sleep(500);
}

async function clickSend() {
  const st = freshState();
  const send = findBy(st, { role: "Button", name: "Send message" });
  assert(send, "Send button not found (is the composer busy?)");
  clickBy(app.pid, st, { role: "Button", name: "Send message" });
  await sleep(400);
}

async function waitText(text, timeout = 25000) {
  const el = await waitFor(freshState(), { text }, timeout);
  assert(el, `Expected text "${text}" to appear`);
  return freshState();
}

/** Wait until the simulated turn completes (the Stop button disappears). */
async function ensureIdle(timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const s = freshState();
    if (!findBy(s, { role: "Button", name: "Stop generating" })) return s;
    await sleep(400);
  }
  assert(false, "Composer still busy (Stop button present) after timeout");
  return freshState();
}

async function sendText(text) {
  await focusComposer();
  await typeInto(text);
  await clickSend();
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

const tests = [
  {
    name: "Profile Studio opens from the header profile chip with the live registry",
    fn: async () => {
      const state = await openStudioFromPicker();
      assertText(state, "New custom profile");
      assertText(state, "Identity");
      assertText(state, "Base mode");
      assertText(state, "Tools — live registry");
      // Live registry: built-in tools render as switches (the demo registry
      // also surfaces MCP + skill tools from the mock runtime).
      const shellToggle = findBy(state, { text: "shell built-in" });
      assert(shellToggle, "Built-in tool toggle (shell) missing from the live registry");
      assertText(state, "Live composition");
      assertText(state, "What the app shows right now");
      // Save is disabled for an empty draft — the footer warns about degrading.
      assertText(state, "Create profile");
      takeScreenshot(app.pid, "studio-open", app.windowId);
    },
  },

  {
    name: "Create a custom profile — becomes active immediately (hot reload) and appears in the picker",
    fn: async () => {
      // Fresh studio (the previous test left it open).
      if (!getTextContent(freshState()).includes("New custom profile")) {
        await openStudioFromPicker();
      }
      await typeIntoField(app.pid, app.windowId, "Profile name", "Builder Bot");
      await typeIntoField(app.pid, app.windowId, "Profile tagline", "Compose fast, verify always");
      await typeIntoField(app.pid, app.windowId, "Working style", "Goal first\nVerify with real runs");
      // The draft hot-reloads: the live preview reflects the edits immediately.
      let s = freshState();
      assertText(s, "Builder Bot");
      assertText(s, "Compose fast, verify always");
      // Toggle an extra tool (an extension tool — the built-ins are already on
      // for a fresh draft) so the composition visibly composes.
      await toggleTool(app.pid, app.windowId, "create_issue extension");
      s = freshState();
      assertText(s, "create_issue");
      takeScreenshot(app.pid, "studio-draft", app.windowId);

      // Save → drawer closes, the new profile is selected and the chip shows it.
      const save = await waitFor(freshState(), { role: "Button", text: "Create profile" }, 8000);
      assert(save, "Create profile button not found");
      clickBy(app.pid, freshState(), { role: "Button", text: "Create profile" });
      await sleep(900);
      const closed = freshState();
      assert(!findBy(closed, { text: "New custom profile" }), "Studio drawer did not close after Save");
      assertText(closed, "Builder Bot");

      // The picker lists it under Custom.
      await openProfilePicker();
      assertText(freshState(), "Custom");
      assertText(freshState(), "Edit Builder Bot");
      takeScreenshot(app.pid, "studio-created", app.windowId);
      // Close the picker (click the trigger again).
      clickBy(app.pid, freshState(), { role: "Button", text: "Profile" });
      await sleep(400);
    },
  },

  {
    name: "Demo response follows the custom profile (flavor: name, tagline, working style)",
    fn: async () => {
      // Builder Bot is active from the previous test — the header chip + composer hint show it.
      assertText(freshState(), "Builder Bot");
      assertText(freshState(), "Compose fast, verify always");
      // Send a message: the simulated answer must follow the custom profile.
      await sendText("show me what this profile does");
      await ensureIdle(30000);
      const after = freshState();
      // The custom flavor block only appears once the turn finished streaming.
      assertText(after, "status — demo run in the");
      assertText(after, "Builder Bot");
      assertText(after, "Goal first");
      takeScreenshot(app.pid, "studio-demo-follow", app.windowId);
    },
  },

  {
    name: "Edit hot-reloads the draft and Save persists it",
    fn: async () => {
      await openProfilePicker();
      const edit = await waitFor(freshState(), { text: "Edit Builder Bot" }, 8000);
      assert(edit, "Edit button for Builder Bot not found");
      clickBy(app.pid, freshState(), { text: "Edit Builder Bot" });
      const header = await waitFor(freshState(), { text: "Edit custom profile" }, 8000);
      assert(header, "Studio did not open in edit mode");
      await sleep(500);

      // Append to the name while the drawer is open — the harness appends at
      // the field's end (keyboard editing is not deliverable to WebView2), and
      // the live preview follows the draft immediately.
      await typeIntoField(app.pid, app.windowId, "Profile name", " 2");
      const during = freshState();
      assertText(during, "Builder Bot 2");

      // Save persists the rename.
      const save = await waitFor(freshState(), { role: "Button", text: "Save changes" }, 8000);
      assert(save, "Save changes button not found in edit mode");
      clickBy(app.pid, freshState(), { role: "Button", text: "Save changes" });
      await sleep(900);
      assertText(freshState(), "Builder Bot 2");
      takeScreenshot(app.pid, "studio-edited", app.windowId);
    },
  },

  {
    name: "Discard reverts the draft without persisting",
    fn: async () => {
      await openProfilePicker();
      const edit = await waitFor(freshState(), { text: "Edit Builder Bot 2" }, 8000);
      assert(edit, "Edit button for Builder Bot 2 not found");
      clickBy(app.pid, freshState(), { text: "Edit Builder Bot 2" });
      const header = await waitFor(freshState(), { text: "Edit custom profile" }, 8000);
      assert(header, "Studio did not open in edit mode");
      await sleep(500);

      // Append a temporary suffix, then Discard.
      await typeIntoField(app.pid, app.windowId, "Profile name", " TEMP");
      assertText(freshState(), "Builder Bot 2 TEMP");
      const discard = await waitFor(freshState(), { role: "Button", text: "Discard" }, 8000);
      assert(discard, "Discard button not found");
      clickBy(app.pid, freshState(), { role: "Button", text: "Discard" });
      await sleep(800);

      // Reverted: the draft is gone and the persisted name is back.
      const after = freshState();
      assert(!findBy(after, { text: "Builder Bot 2 TEMP" }), "Discarded draft name still present");
      assertText(after, "Builder Bot 2");
    },
  },

  {
    name: "Delete removes the custom profile and falls back to Standard",
    fn: async () => {
      await openProfilePicker();
      const del = await waitFor(freshState(), { text: "Delete Builder Bot 2" }, 8000);
      assert(del, "Delete button for Builder Bot 2 not found");
      clickBy(app.pid, freshState(), { text: "Delete Builder Bot 2" });
      await sleep(900);
      const after = freshState();
      assertText(after, "No custom profiles yet");
      // The deleted profile was active — the app degrades to Standard.
      assertText(after, "Standard");
      takeScreenshot(app.pid, "studio-deleted", app.windowId);
    },
  },

  {
    name: "Custom profile selection + store survive an app restart",
    fn: async () => {
      // Create a profile to carry across the restart.
      await openStudioFromPicker();
      await typeIntoField(app.pid, app.windowId, "Profile name", "Persistent Bot");
      const save = await waitFor(freshState(), { role: "Button", text: "Create profile" }, 8000);
      assert(save, "Create profile button not found");
      clickBy(app.pid, freshState(), { role: "Button", text: "Create profile" });
      await sleep(900);
      assertText(freshState(), "Persistent Bot");

      // Relaunch WITHOUT clearing storage — selection + store must survive.
      await relaunch();
      const after = freshState();
      assertText(after, "Persistent Bot");
      // The picker still lists it under Custom.
      await openProfilePicker();
      assertText(freshState(), "Persistent Bot");
      assertText(freshState(), "Edit Persistent Bot");
      takeScreenshot(app.pid, "studio-restart-persisted", app.windowId);
    },
  },
];

// ---------------------------------------------------------------------------
// Runner (self-contained, mirrors shell.test.mjs)
// ---------------------------------------------------------------------------

async function runTest(test) {
  const stale = (msg) => /window_id|window .* exists|Sophos window unavailable|replaced by a concurrent worker/.test(String(msg));
  for (let attempt = 1; attempt <= (test.maxAttempts || 2); attempt++) {
    const start = Date.now();
    try {
      if (!app.pid) await beforeAll();
      await test.fn();
      const elapsed = Date.now() - start;
      console.log(`  \u2713 ${test.name} (${elapsed}ms)`);
      return { name: test.name, pass: true, elapsed };
    } catch (err) {
      const retriable = stale(err.message) || attempt === 1;
      if (retriable) {
        console.log(`    [retry] ${test.name} — ${err.message}`);
        try { closeApp(app.pid); } catch {}
        await relaunch();
        continue;
      }
      const elapsed = Date.now() - start;
      console.error(`  \u2717 ${test.name} (${elapsed}ms): ${err.message}`);
      return { name: test.name, pass: false, elapsed, error: err.message };
    }
  }
  return { name: test.name, pass: false, elapsed: 0, error: "retry exhausted" };
}

console.log("\n=== Sophos Profile Studio (demo mode) ===");
await beforeAll();
const results = [];
for (const test of tests) results.push(await runTest(test));
await afterAll();

const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
console.log(`\nSophos Profile Studio e2e: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;

if (failed === 0) {
  console.log("\nSTUDIO TEST: PASS");
} else {
  console.log(`\nSTUDIO TEST: FAIL (${failed} failed)`);
}
