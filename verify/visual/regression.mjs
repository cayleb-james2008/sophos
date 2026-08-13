// verify/visual/regression.mjs — visual regression runner.
//
//   node verify/visual/regression.mjs
//   npm run test:visual
//
// Starts an owned ephemeral Vite server, launches the system Chrome headless at
// 1440x900, captures the current screenshot of each of the five views, compares
// it against the baseline in verify/visual/baselines with pixelmatch, and fails
// any view whose differing-pixel ratio exceeds 0.1%. Failing views also write a
// diff image to verify/visual/diffs/<view>-diff.png.
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import {
  BASELINE_DIR,
  DIFF_DIR,
  VIEWS,
  REPORT_PATH,
  SUMMARY_PATH,
  PIXEL_TOLERANCE,
  MAX_DIFF_RATIO,
  startOwnedDevServer,
  stopOwnedDevServer,
  launch,
  gotoApp,
  captureView,
  dismissOnboarding,
} from "./helpers.mjs";

function comparePngs(baselinePath, currentPath, diffPath) {
  const img1 = PNG.sync.read(readFileSync(baselinePath));
  const img2 = PNG.sync.read(readFileSync(currentPath));
  if (img1.width !== img2.width || img1.height !== img2.height) {
    return {
      ok: false,
      reason: `dimension mismatch: baseline ${img1.width}x${img1.height} vs current ${img2.width}x${img2.height}`,
      diffRatio: null,
      diffPixels: null,
    };
  }
  const diff = new PNG({ width: img1.width, height: img1.height });
  const diffPixels = pixelmatch(img1.data, img2.data, diff.data, img1.width, img1.height, {
    threshold: PIXEL_TOLERANCE,
    includeAA: true,
  });
  const ratio = diffPixels / (img1.width * img1.height);
  const ok = ratio <= MAX_DIFF_RATIO;
  if (!ok) writeFileSync(diffPath, PNG.sync.write(diff));
  return { ok, reason: ok ? "within threshold" : `diff ${(ratio * 100).toFixed(4)}% > 0.1%`, diffRatio: ratio, diffPixels };
}

async function main() {
  const startedAt = new Date().toISOString();
  let server;
  let browser;
  let tmp;
  const results = [];

  try {
    server = await startOwnedDevServer();
    const { browser: b, page } = await launch();
    browser = b;
    await gotoApp(page, server.url);
    await dismissOnboarding(page);
    tmp = mkdtempSync(join(tmpdir(), "sophos-visual-current-"));

    for (const view of VIEWS) {
      const baseline = join(BASELINE_DIR, `${view.id}.png`);
      const current = join(tmp, `${view.id}.png`);
      const diff = join(DIFF_DIR, `${view.id}-diff.png`);
      const rec = {
        view: view.id,
        label: view.label,
        baseline: baseline.replace(/\\/g, "/"),
        current: null,
        diff: null,
        ok: false,
        detail: "",
        diffRatio: null,
        diffPixels: null,
      };
      try {
        const info = await captureView(page, view, current);
        rec.current = current.replace(/\\/g, "/");
        rec.width = info.width;
        rec.height = info.height;

        let baselineExists = true;
        try { readFileSync(baseline); } catch { baselineExists = false; }

        if (!baselineExists) {
          rec.detail = "no baseline — run npm run test:visual:update first";
        } else {
          const cmp = comparePngs(baseline, current, diff);
          rec.ok = cmp.ok;
          rec.detail = cmp.reason;
          rec.diffRatio = cmp.diffRatio;
          rec.diffPixels = cmp.diffPixels;
          if (!cmp.ok) rec.diff = diff.replace(/\\/g, "/");
        }
      } catch (e) {
        rec.detail = e instanceof Error ? e.message : String(e);
      }
      results.push(rec);
    }
  } catch (e) {
    results.push({ view: "(harness)", label: "(harness)", baseline: null, current: null, diff: null, ok: false, detail: e instanceof Error ? e.message : String(e), diffRatio: null, diffPixels: null });
  } finally {
    try { await browser?.close(); } catch {}
    await stopOwnedDevServer(server);
    if (tmp) { try { rmSync(tmp, { recursive: true, force: true }); } catch {} }
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  const overall = failed === 0 ? "PASS" : "FAIL";

  const report = {
    suite: "sophos-visual-regression",
    mode: "browser-demo (MockIpcClient)",
    viewport: { width: 1440, height: 900 },
    threshold: { pixelTolerance: PIXEL_TOLERANCE, maxDiffRatio: MAX_DIFF_RATIO },
    startedAt,
    finishedAt: new Date().toISOString(),
    results,
    summary: { total: results.length, passed, failed, overall },
  };
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  // Console summary.
  console.log(`\n=== Sophos visual regression ===`);
  for (const r of results) {
    const ratio = r.diffRatio == null ? "" : ` (${(r.diffRatio * 100).toFixed(4)}% diff)`;
    console.log(`  ${r.ok ? "✓ PASS" : "✗ FAIL"} ${r.view.padEnd(9)} ${r.detail}${ratio}`);
    if (r.diff) console.log(`          diff: ${r.diff}`);
  }
  console.log(`\n${overall} — ${passed}/${results.length} passed`);
  if (failed > 0) process.exitCode = 1;

  // Markdown summary for humans.
  const lines = [
    `# Sophos Visual Regression — Summary`,
    ``,
    `Date: ${new Date().toISOString()} · Mode: browser-demo (MockIpcClient) · Viewport 1440x900`,
    ``,
    `## Result: ${overall} (${passed}/${results.length} passed)`,
    ``,
    `Threshold: >0.1% differing pixels fails (pixelmatch per-channel tolerance ${PIXEL_TOLERANCE})`,
    ``,
    `| View | Result | Detail | Diff ratio |`,
    `|---|---|---|---|`,
  ];
  for (const r of results) {
    lines.push(`| ${r.view} | ${r.ok ? "✅ PASS" : "❌ FAIL"} | ${(r.detail || "").replace(/\|/g, "\\|")} | ${r.diffRatio == null ? "—" : `${(r.diffRatio * 100).toFixed(4)}%`} |`);
  }
  lines.push(``, `## Diffs`, ``);
  const diffs = results.filter((r) => r.diff);
  if (diffs.length) for (const r of diffs) lines.push(`- \`${r.diff}\``);
  else lines.push(`None — all views within threshold.`);
  lines.push(``, `JSON report: \`verify/visual/visual-report.json\``);
  writeFileSync(SUMMARY_PATH, lines.join("\n"));
}

main();
