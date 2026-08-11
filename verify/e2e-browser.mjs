#!/usr/bin/env node
/**
 * verify/e2e-browser.mjs — browser-driven end-to-end + edge-case suite for the
 * Sophos app, running on an owned ephemeral Vite dev server in the browser-
 * demo mode (MockIpcClient). Uses Playwright-core directly against the
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
import { createHarness, launch, gotoApp, startOwnedDevServer, stopOwnedDevServer, writeReport, writeSummary } from "./e2e/helpers.mjs";
import { views } from "./e2e/views.test.mjs";
import { flows } from "./e2e/flows.test.mjs";
import { edge } from "./e2e/edge.test.mjs";

const startedAt = new Date().toISOString();
const harness = createHarness();

async function main() {
  const devServer = await startOwnedDevServer();
  let current;

  try {
    current = await launch();
    const { page } = current;
    page.on("console", (m) => { if (m.type() === "error") harness.recordError("console: " + m.text()); });
    page.on("pageerror", (e) => harness.recordError("pageerror: " + e.message));

    const relaunch = async () => {
      try { await current.browser.close(); } catch {}
      current = await launch();
      current.page.on("console", (m) => { if (m.type() === "error") harness.recordError("console: " + m.text()); });
      current.page.on("pageerror", (e) => harness.recordError("pageerror: " + e.message));
      await gotoApp(current.page, devServer.url);
    };

    await gotoApp(page, devServer.url);

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
    // Browser hygiene: close only the browser instance(s) this run created.
    try { await current?.browser.close(); } catch {}
    await stopOwnedDevServer(devServer);
  }

  const report = writeReport(harness, { startedAt, appUrl: devServer.url });
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
