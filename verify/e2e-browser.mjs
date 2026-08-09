#!/usr/bin/env node
/**
 * verify/e2e-browser.mjs — browser-driven end-to-end + edge-case suite for the
 * Sophos app, running on the LIVE dev server (npm run dev, Vite :1420) in the
 * browser-demo mode (MockIpcClient). Uses Playwright-core directly against the
 * system Chrome — no agent-browser daemon.
 *
 * Coverage:
 *   - Every view: Chat, Sessions, Agents, Inbox, Settings (General/Providers/
 *     Skills/Advanced + Long-running: Goals/Autonomous/Heartbeats/Schedules/
 *     Refinement), Engine terminal.
 *   - Agentic flows: send, steering, follow-up queue, abort, side questions,
 *     command palette, session new/resume/fork, model selector, provider
 *     login/logout, export.
 *   - Edge cases: empty/invalid input, busy state, transient indicators,
 *     empty states, engine-disconnected (demo) state, console-error sweep.
 *
 * Evidence: screenshots per view + verify/e2e/e2e-report.json (machine-
 * readable) + verify/e2e/e2e-summary.md (human-readable).
 *
 * Exit 0 iff every test passes. Browser tree is always killed on exit.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createHarness, launch, gotoApp, writeReport, writeSummary, APP_URL, REPO } from "./e2e/helpers.mjs";
import { views } from "./e2e/views.test.mjs";
import { flows } from "./e2e/flows.test.mjs";
import { edge } from "./e2e/edge.test.mjs";

const startedAt = new Date().toISOString();
const harness = createHarness();

// ---- Ensure the dev server is up (spawn if not) -------------------------
async function ensureDevServer() {
  try {
    const res = await fetch(APP_URL);
    if (res.ok) return null;
  } catch {}
  // Not running — start it. Spawn the vite server via node directly (a .cmd
  // batch cannot be spawned detached on Windows — EINVAL).
  const viteBin = join(REPO, "node_modules", "vite", "bin", "vite.js");
  const proc = spawn(process.execPath, [viteBin], { stdio: "ignore", detached: true });
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    try { const r = await fetch(APP_URL); if (r.ok) return proc; } catch {}
  }
  throw new Error("dev server did not start on " + APP_URL);
}

// ---- Reap any stray headless Chrome from prior runs ---------------------
function killStrayChrome() {
  try {
    const out = execFileSync("powershell", [
      "-NoProfile", "-Command",
      "Get-CimInstance Win32_Process -Filter 'Name=\"chrome.exe\"' | Where-Object { $_.CommandLine -match \"--headless\" -and $_.CommandLine -match \"playwright\" } | ForEach-Object { $_.ProcessId }",
    ], { encoding: "utf8", timeout: 8000 }).toString();
    for (const pid of out.split("\n").map((s) => parseInt(s.trim(), 10)).filter(Number.isFinite)) {
      try { execFileSync("taskkill", ["/F", "/T", "/PID", String(pid)], { stdio: "ignore", timeout: 5000 }); } catch {}
    }
  } catch {}
}

async function main() {
  killStrayChrome();
  const devProc = await ensureDevServer();

  const { browser, page } = await launch();
  // Wire error capture for the whole run.
  page.on("console", (m) => { if (m.type() === "error") harness.recordError("console: " + m.text()); });
  page.on("pageerror", (e) => harness.recordError("pageerror: " + e.message));

  let current = { browser, page };
  const relaunch = async () => {
    try { await current.browser.close(); } catch {}
    current = await launch();
    current.page.on("console", (m) => { if (m.type() === "error") harness.recordError("console: " + m.text()); });
    current.page.on("pageerror", (e) => harness.recordError("pageerror: " + e.message));
    await gotoApp(current.page);
  };

  try {
    await gotoApp(page);

    const all = [...views, ...flows, ...edge];
    for (const t of all) {
      // If the page died, relaunch before the next test.
      if (current.page.isClosed()) await relaunch();
      const run = harness.test(t.section, t.name, t.fn);
      const ok = await run(current.page);
      // Cleanup: close any modal left open so it can't block the next test.
      try {
        if (!current.page.isClosed() && (await current.page.locator('[role="dialog"]').count()) > 0) {
          await current.page.keyboard.press("Escape").catch(() => {});
          await current.page.waitForTimeout(200);
        }
      } catch {}
      if (!ok) console.log(`FAIL  [${t.section}] ${t.name} — ${harness.results[harness.results.length - 1].error}`);
      else console.log(`PASS  [${t.section}] ${t.name}`);
    }
  } finally {
    // Browser hygiene: always close the browser (kills the whole tree).
    try { await current.browser.close(); } catch {}
    // Kill the dev server we started (if any) — taskkill /T reaps the whole tree.
    if (devProc) {
      try { execFileSync("taskkill", ["/F", "/T", "/PID", String(devProc.pid)], { stdio: "ignore", timeout: 8000 }); } catch {}
    }
    killStrayChrome();
  }

  const report = writeReport(harness, { startedAt });
  writeSummary(harness, { startedAt });
  console.log("\n=== SUMMARY ===");
  console.log(`passed ${report.summary.passed}/${report.summary.total}, failed ${report.summary.failed}`);
  console.log(`overall: ${report.summary.overall}`);
  console.log(`report:  verify/e2e/e2e-report.json`);
  console.log(`summary: verify/e2e/e2e-summary.md`);
  console.log(`screenshots: ${harness.screenshots.length} in verify/e2e/screenshots/`);
  process.exit(report.summary.failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error("e2e-browser crashed:", e); process.exit(2); });
