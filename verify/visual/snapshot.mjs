// verify/visual/snapshot.mjs — capture baseline screenshots for all 5 views.
//
//   node verify/visual/snapshot.mjs
//   npm run test:visual:update
//
// Starts an owned ephemeral Vite server, launches the system Chrome headless
// at 1440x900, navigates through each of the five views, and writes a full-page
// screenshot to verify/visual/baselines/<view>.png.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  BASELINE_DIR,
  VIEWS,
  startOwnedDevServer,
  stopOwnedDevServer,
  launch,
  gotoApp,
  settleView,
  captureView,
  dismissOnboarding,
} from "./helpers.mjs";

async function main() {
  const startedAt = new Date().toISOString();
  let server;
  let browser;
  const captured = [];
  const errors = [];

  try {
    server = await startOwnedDevServer();
    const { browser: b, page } = await launch();
    browser = b;
    await gotoApp(page, server.url);
    await dismissOnboarding(page);

    for (const view of VIEWS) {
      try {
        const outPath = join(BASELINE_DIR, `${view.id}.png`);
        const info = await captureView(page, view, outPath);
        captured.push({
          view: view.id,
          label: view.label,
          file: outPath,
          width: info.width,
          height: info.height,
        });
      } catch (e) {
        errors.push({ view: view.id, error: e instanceof Error ? e.message : String(e) });
      }
    }
  } catch (e) {
    errors.push({ view: "(harness)", error: e instanceof Error ? e.message : String(e) });
  } finally {
    try { await browser?.close(); } catch {}
    await stopOwnedDevServer(server);
  }

  const report = {
    suite: "sophos-visual-snapshot",
    mode: "browser-demo (MockIpcClient)",
    viewport: { width: 1440, height: 900 },
    startedAt,
    finishedAt: new Date().toISOString(),
    baselinesDir: BASELINE_DIR,
    captured,
    errors,
    summary: {
      total: VIEWS.length,
      captured: captured.length,
      failed: errors.length,
      overall: errors.length === 0 && captured.length === VIEWS.length ? "OK" : "FAIL",
    },
  };
  writeFileSync(join(BASELINE_DIR, "report.json"), JSON.stringify(report, null, 2));

  console.log(`\n=== Sophos visual snapshot ===`);
  for (const c of captured) console.log(`  ✓ ${c.view.padEnd(9)} ${c.file} (${c.width}x${c.height})`);
  for (const e of errors) console.log(`  ✗ ${e.view.padEnd(9)} ${e.error}`);
  console.log(`\n${report.summary.overall} — ${captured.length}/${VIEWS.length} views captured`);
  if (report.summary.overall !== "OK") process.exitCode = 1;
}

main();
