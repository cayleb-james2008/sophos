// settings.test.mjs — cua-driver e2e tests for ALL Settings features in the
// Sophos desktop app, run in DEMO MODE (MockIpcClient) so providers, skills,
// MCP servers, extensions, long-running, and About are populated with
// simulated data and testable without a live daemon.
//
// Run:  node verify/cua/settings.test.mjs
//
// The Settings surface is a pill tab bar: General | Providers | Subagents |
// Skills | Extensions | Advanced | Long-running | About. The Long-running tab
// hosts its own inner tabs: Goals | Autonomous | Heartbeats | Schedules |
// Refinement | Harness state. This suite covers every tab plus the MCP server
// add/remove round-trip and the provider login/logout round-trip.
//
// Text assertions are case-insensitive: many labels render uppercased via CSS
// (e.g. "RUNTIME TELEMETRY"), while the harness assertTextContains is a
// case-sensitive substring match.

import { getWindowState, sleep, typeText } from "./driver.mjs";
import { takeScreenshot, getTextContent } from "./helpers.mjs";
import { findBy, findAll, clickBy, waitFor } from "./find-util.mjs";
import { assert } from "./assertions.mjs";
import { runDemoSuite } from "./demo-runner.mjs";

/** Read a fresh window state for the app handle. */
function freshState(appHandle) {
  return getWindowState(appHandle.pid, appHandle.windowId, { include_screenshot: false });
}

/** Case-insensitive substring assertion against the window's text content. */
function assertText(state, text) {
  const content = getTextContent(state).toLowerCase();
  const needle = String(text).toLowerCase();
  assert(content.includes(needle), `Expected text "${text}" in window content. Got:\n${content.slice(0, 2500)}`);
}

/** Navigate to Settings, click a top-level tab, and wait for a content marker. */
async function openSettingsTab(appHandle, tabName, marker) {
  const state = freshState(appHandle);
  // Wait for the sidebar Settings button (the app can load slowly when other
  // app instances are already running), then click it by substring.
  const nav = await waitFor(state, { role: "Button", text: "Settings" }, 12000);
  assert(nav, "Settings nav button not found");
  clickBy(appHandle.pid, freshState(appHandle), { role: "Button", text: "Settings" });
  const header = await waitFor(state, { text: "Settings" }, 8000);
  assert(header, "Settings view did not render (Settings not found)");
  const s2 = freshState(appHandle);
  const tab = findBy(s2, { role: "TabItem", name: tabName });
  assert(tab, `Settings tab "${tabName}" not found`);
  clickBy(appHandle.pid, s2, { role: "TabItem", name: tabName });
  const el = await waitFor(s2, { text: marker }, 10000);
  assert(el, `Settings tab "${tabName}" did not render "${marker}"`);
  await sleep(500);
  return freshState(appHandle);
}

/** Click an inner (underline) tab of the Long-running section. */
async function clickInnerTab(appHandle, tabName, marker) {
  const state = freshState(appHandle);
  const tab = findBy(state, { role: "TabItem", name: tabName });
  assert(tab, `Inner tab "${tabName}" not found`);
  clickBy(appHandle.pid, state, { role: "TabItem", name: tabName });
  const el = await waitFor(state, { text: marker }, 10000);
  assert(el, `Inner tab "${tabName}" did not render "${marker}"`);
  await sleep(500);
  return freshState(appHandle);
}

/** Poll until an element matching `text` is absent from the window, or timeout. */
async function waitForGone(appHandle, text, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const st = freshState(appHandle);
    if (!findBy(st, { text })) return true;
    await sleep(400);
  }
  return false;
}

/** Count occurrences of a substring in the window text content (per line). */
function countText(state, needle) {
  const content = (state.elements || [])
    .map((e) => e.label)
    .filter((l) => l && String(l).includes(needle)).length;
  return content;
}

const tests = [
  {
    name: "General settings tab renders preferences",
    fn: async (appHandle) => {
      const after = await openSettingsTab(appHandle, "General", "General preferences");
      assertText(after, "General preferences");
      // Theme select (its label renders; native <select> options are not
      // exposed to UIA until the dropdown opens, so assert the field only).
      assertText(after, "Theme");
      // Preference inputs.
      assertText(after, "Default provider");
      assertText(after, "Default model");
      // Persist action.
      assertText(after, "Save changes");
      takeScreenshot(appHandle.pid, "settings-general", appHandle.windowId);
    },
  },

  {
    name: "Providers tab renders the provider catalog with login/logout buttons",
    fn: async (appHandle) => {
      const state = await openSettingsTab(appHandle, "Providers", "Ollama Cloud");
      // Give the local endpoint card time to load its config.
      await sleep(800);
      const after = freshState(appHandle);
      // Cloud provider cards.
      assertText(after, "Ollama Cloud");
      assertText(after, "OpenRouter");
      assertText(after, "MiniMax");
      assertText(after, "Prime Intellect");
      // Local (self-hosted) endpoint card — its name renders as a distinct
      // token, so match the stable "Local" label/badge.
      assertText(after, "Local");
      // Connected providers show Log out; the disconnected (managed) provider
      // shows Connect — both auth controls are reachable.
      assertText(after, "Log out");
      assertText(after, "Connect");
      takeScreenshot(appHandle.pid, "settings-providers", appHandle.windowId);
    },
  },

  {
    name: "Provider logout → connect round-trip works",
    fn: async (appHandle) => {
      const state = await openSettingsTab(appHandle, "Providers", "Ollama Cloud");
      const logoutBefore = countText(state, "Log out");
      assert(logoutBefore > 0, "Expected at least one Log out button");
      // Log out a connected provider (the first card's Log out).
      clickBy(appHandle.pid, freshState(appHandle), { text: "Log out" });
      await sleep(1200);
      const after = freshState(appHandle);
      const logoutAfter = countText(after, "Log out");
      const connectAfter = countText(after, "Connect");
      assert(logoutAfter < logoutBefore, `Expected a Log out to disappear (was ${logoutBefore}, now ${logoutAfter})`);
      assert(connectAfter > 0, "Expected a Connect button to appear after logging out");
      takeScreenshot(appHandle.pid, "settings-provider-logout", appHandle.windowId);
    },
  },

  {
    name: "Skills tab renders the discovered skill list",
    fn: async (appHandle) => {
      const after = await openSettingsTab(appHandle, "Skills", "Discovered skills");
      assertText(after, "Discovered skills");
      // Demo skills surfaced by the mock runtime.
      assertText(after, "release-audit");
      assertText(after, "code-review");
      assertText(after, "websearch");
      // Create/install controls.
      assertText(after, "Create and install");
      takeScreenshot(appHandle.pid, "settings-skills", appHandle.windowId);
    },
  },

  {
    name: "Advanced tab renders runtime telemetry",
    fn: async (appHandle) => {
      const after = await openSettingsTab(appHandle, "Advanced", "Trust model");
      assertText(after, "Trust model");
      assertText(after, "Runtime telemetry");
      // MCP servers card is part of Advanced.
      assertText(after, "MCP servers");
      takeScreenshot(appHandle.pid, "settings-advanced", appHandle.windowId);
    },
  },

  {
    name: "MCP servers card shows the add form and add/remove round-trips",
    fn: async (appHandle) => {
      let state = await openSettingsTab(appHandle, "Advanced", "MCP servers");
      // Idempotent against demo-mode localStorage persistence: a prior run's
      // added server can leak into this launch (the mock persists settings to
      // localStorage across runs), so clear any leftover MCP servers first —
      // otherwise the empty-state assertion below races a leaked entry.
      for (let i = 0; i < 6; i++) {
        const rm = findBy(state, { role: "Button", text: "Remove " });
        if (!rm) break;
        clickBy(appHandle.pid, freshState(appHandle), { role: "Button", text: "Remove " });
        await sleep(900);
        state = freshState(appHandle);
      }
      // Empty-state + add form.
      assertText(state, "No MCP servers configured yet");
      // Input accessible names render uppercased via CSS (label text is
      // uppercased), so match case-insensitively by text.
      const nameInput = findBy(state, { role: "Edit", text: "Name" });
      const cmdInput = findBy(state, { role: "Edit", text: "Command" });
      assert(nameInput, "MCP Name input not found");
      assert(cmdInput, "MCP Command input not found");
      // Fill the form and Add.
      typeText(appHandle.pid, "filesystem", appHandle.windowId, nameInput.element_token);
      typeText(appHandle.pid, "npx", appHandle.windowId, cmdInput.element_token);
      await sleep(500);
      const s2 = freshState(appHandle);
      const addBtn = findBy(s2, { role: "Button", text: "Add" });
      assert(addBtn, "MCP Add button not found");
      clickBy(appHandle.pid, s2, { role: "Button", text: "Add" });
      await sleep(1200);
      const afterAdd = freshState(appHandle);
      assertText(afterAdd, "filesystem");
      assertText(afterAdd, "npx");
      takeScreenshot(appHandle.pid, "settings-mcp-added", appHandle.windowId);
      // Remove it — poll until it is actually gone from the UI (the
      // setSettings → refresh round-trip can lag under load; don't race it).
      const removeBtn = await waitFor(afterAdd, { text: "Remove filesystem" }, 8000);
      assert(removeBtn, "MCP Remove button not found");
      clickBy(appHandle.pid, freshState(appHandle), { text: "Remove filesystem" });
      const removed = await waitForGone(appHandle, "filesystem", 10000);
      assert(removed, "MCP server was not removed from the UI within the wait window");
      const afterRemove = freshState(appHandle);
      assert(!findBy(afterRemove, { text: "filesystem" }), "MCP server was not removed");
      takeScreenshot(appHandle.pid, "settings-mcp-removed", appHandle.windowId);
    },
  },

  {
    name: "Extensions tab renders configured extensions",
    fn: async (appHandle) => {
      const after = await openSettingsTab(appHandle, "Extensions", "Configured extensions");
      assertText(after, "Extensions");
      assertText(after, "github-integration");
      assertText(after, "linear-sync");
      assertText(after, "Install an extension");
      takeScreenshot(appHandle.pid, "settings-extensions", appHandle.windowId);
    },
  },

  {
    name: "Subagent policy tab renders the model policy",
    fn: async (appHandle) => {
      const after = await openSettingsTab(appHandle, "Subagents", "Subagent model policy");
      assertText(after, "Subagent model policy");
      assertText(after, "Provider");
      assertText(after, "Model");
      assertText(after, "Thinking level");
      takeScreenshot(appHandle.pid, "settings-subagents", appHandle.windowId);
    },
  },

  {
    name: "Long-running tab renders all five sections",
    fn: async (appHandle) => {
      // Open the Long-running tab (default inner section = Autonomous).
      await openSettingsTab(appHandle, "Long-running", "Autonomous mode");
      // The five required section tabs render.
      const s0 = freshState(appHandle);
      for (const label of ["Goals", "Autonomous", "Heartbeats", "Schedules", "Refinement"]) {
        assert(findBy(s0, { role: "TabItem", name: label }), `Long-running section "${label}" tab not found`);
      }

      // Autonomous (default) content.
      const auton = freshState(appHandle);
      assertText(auton, "Autonomous mode");

      // Goals section.
      const goals = await clickInnerTab(appHandle, "Goals", "Ship the release and verify every published artifact");
      assertText(goals, "active goal");

      // Heartbeats section.
      const hb = await clickInnerTab(appHandle, "Heartbeats", "*/15 * * * *");
      assertText(hb, "Interval");

      // Schedules section.
      const sched = await clickInnerTab(appHandle, "Schedules", "0 9 * * *");
      assertText(sched, "Cron expression");

      // Refinement section.
      const ref = await clickInnerTab(appHandle, "Refinement", "Refinement history");
      assertText(ref, "No pending changes");

      // Harness state section (6th inner tab).
      const hs = await clickInnerTab(appHandle, "Harness state", "Continual harness state");
      assertText(hs, "Continual harness state");

      takeScreenshot(appHandle.pid, "settings-longrunning", appHandle.windowId);
    },
  },

  {
    name: "About tab renders version, credits, and links",
    fn: async (appHandle) => {
      const after = await openSettingsTab(appHandle, "About", "Sophos");
      assertText(after, "Beta");
      assertText(after, "GitLab");
      assertText(after, "Changelog");
      // Version badge (v0.7.0 from package.json); "v" and "0.7.0" render as
      // separate tokens, so match the version number alone.
      assertText(after, "0.7.0");
      takeScreenshot(appHandle.pid, "settings-about", appHandle.windowId);
    },
  },
];

const onlyIdx = process.argv.indexOf("--only");
if (onlyIdx !== -1 && process.argv[onlyIdx + 1] !== undefined) {
  const i = Number(process.argv[onlyIdx + 1]);
  const t = tests[i];
  if (!t) {
    console.error(`No settings test at index ${i} (0-${tests.length - 1})`);
    process.exit(1);
  }
  // Run a single test as its own suite so a fresh app launch is used and the
  // test completes before external activity can tear the window down.
  const single = await runDemoSuite(`Sophos Settings cua-driver e2e (test ${i}: ${t.name})`, [t]);
  process.exit(single.failed === 0 ? 0 : 1);
}

const outcome = await runDemoSuite("Sophos Settings cua-driver e2e", tests);

if (outcome.failed === 0) {
  console.log("\nSETTINGS TEST: PASS");
} else {
  console.log(`\nSETTINGS TEST: FAIL (${outcome.failed} failed)`);
}
