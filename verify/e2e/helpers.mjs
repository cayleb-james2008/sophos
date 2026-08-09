// verify/e2e/helpers.mjs — shared harness for the browser-driven e2e suite.
// Drives the LIVE app (npm run dev, Vite on :1420) with Playwright-core against
// the system Chrome. No agent-browser daemon — Playwright directly.
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
export const APP_URL = "http://localhost:1420/";
export const REPO = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
export const SHOT_DIR = join(REPO, "verify", "e2e", "screenshots");
export const REPORT_PATH = join(REPO, "verify", "e2e", "e2e-report.json");
export const SUMMARY_PATH = join(REPO, "verify", "e2e", "e2e-summary.md");

mkdirSync(SHOT_DIR, { recursive: true });

/** Hard timeout helper — never hangs forever. */
export const HARD = 30000;

/** A tiny test harness: collects pass/fail results + screenshots. */
export function createHarness() {
  const results = [];
  const screenshots = [];
  const consoleErrors = [];
  return {
    results,
    screenshots,
    consoleErrors,
    /** Register a test. fn receives { page, shot, expect } and must return bool. */
    test(section, name, fn) {
      results.push({ section, name, ok: false, detail: "", error: null });
      return async (page) => {
        const rec = results[results.length - 1];
        const shot = (label) => {
          const file = `${section}-${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${label}.png`;
          const path = join(SHOT_DIR, file);
          screenshots.push(path);
          return page.screenshot({ path, fullPage: false }).then(() => path).catch(() => path);
        };
        const expect = (cond, detail) => {
          if (!cond) throw new Error(detail || "assertion failed");
        };
        try {
          const ok = await fn({ page, shot, expect });
          rec.ok = ok !== false;
          if (rec.ok) rec.detail = "ok";
        } catch (e) {
          rec.ok = false;
          rec.error = e instanceof Error ? e.message : String(e);
          rec.detail = rec.error;
        }
        return rec.ok;
      };
    },
    /** Record a console/page error observed during the run. */
    recordError(msg) {
      consoleErrors.push(msg);
    },
  };
}

/** Launch the browser (system Chrome, headless). Returns { browser, page }. */
export async function launch() {
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: [
      "--disable-gpu",
      "--disable-software-rasterizer",
      "--disable-dev-shm-usage",
      "--no-sandbox",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
    ],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  return { browser, page };
}

/** Navigate to the app and wait for the shell to render. */
export async function gotoApp(page) {
  await page.goto(APP_URL, { waitUntil: "networkidle", timeout: HARD });
  await page.waitForSelector("text=Conversation", { timeout: HARD });
  // Wait for the mock connection to flip to connected.
  await page.waitForSelector("text=Engine Live", { timeout: HARD });
}

/** Navigate to a view via the sidebar nav button. */
export async function navTo(page, label) {
  await page.click(`nav button:has-text("${label}")`, { timeout: HARD });
  await page.waitForTimeout(400);
  // Move the mouse to a neutral spot so any nav tooltip stops intercepting
  // pointer events on the next click.
  await page.mouse.move(900, 500);
  await page.waitForTimeout(150);
}

/** Type into the chat composer and press Enter (send). */
export async function sendMessage(page, text) {
  const ta = page.locator('textarea[aria-label="Message input"]');
  await ta.fill(text);
  await ta.press("Enter");
}

/** Wait for the composer to report busy (streaming). */
export async function waitBusy(page, ms = 2000) {
  await page.waitForSelector('button[aria-label="Stop generating"]', { timeout: ms });
}

/** Wait for the composer to report idle (ready). */
export async function waitIdle(page, ms = HARD) {
  await page.waitForSelector('button[aria-label="Send message"]', { timeout: ms });
}

/** Collect any console/page errors currently present. */
export async function collectErrors(page, harness) {
  const errs = await page.evaluate(() => {
    // No direct access to past console; we rely on the event listener.
    return [];
  });
  return errs;
}

/** Write the machine-readable JSON report. */
export function writeReport(harness, meta) {
  const passed = harness.results.filter((r) => r.ok).length;
  const failed = harness.results.filter((r) => !r.ok).length;
  const report = {
    suite: "sophos-browser-e2e",
    mode: "browser-demo (MockIpcClient)",
    app: { url: APP_URL, devServer: "vite :1420" },
    browser: { engine: "chromium", executable: CHROME, headless: true },
    startedAt: meta.startedAt,
    finishedAt: new Date().toISOString(),
    results: harness.results,
    consoleErrors: harness.consoleErrors,
    screenshots: harness.screenshots,
    summary: {
      total: harness.results.length,
      passed,
      failed,
      overall: failed === 0 ? "PASS" : "FAIL",
    },
  };
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  return report;
}

/** Write a human-readable markdown summary. */
export function writeSummary(harness, meta) {
  const passed = harness.results.filter((r) => r.ok).length;
  const failed = harness.results.filter((r) => !r.ok).length;
  const lines = [];
  lines.push(`# Sophos Browser E2E — Summary`);
  lines.push(``);
  lines.push(`Date: ${new Date().toISOString()} · Mode: browser-demo (MockIpcClient) · App: \`npm run dev\` on :1420`);
  lines.push(``);
  lines.push(`## Result: ${failed === 0 ? "PASS" : "FAIL"} (${passed}/${harness.results.length} passed)`);
  lines.push(``);
  const bySection = {};
  for (const r of harness.results) (bySection[r.section] ??= []).push(r);
  for (const [section, rs] of Object.entries(bySection)) {
    lines.push(`## ${section}`);
    lines.push(``);
    lines.push(`| Test | Result | Detail |`);
    lines.push(`|---|---|---|`);
    for (const r of rs) {
      lines.push(`| ${r.name} | ${r.ok ? "✅ PASS" : "❌ FAIL"} | ${(r.error || r.detail || "").replace(/\|/g, "\\|")} |`);
    }
    lines.push(``);
  }
  if (harness.consoleErrors.length) {
    lines.push(`## Console / page errors`);
    lines.push(``);
    for (const e of harness.consoleErrors) lines.push(`- ${e}`);
    lines.push(``);
  }
  lines.push(`## Evidence`);
  lines.push(``);
  lines.push(`- JSON report: \`verify/e2e/e2e-report.json\``);
  lines.push(`- Screenshots: \`verify/e2e/screenshots/\``);
  for (const s of harness.screenshots) lines.push(`  - \`${s.replace(/\\/g, "/")}\``);
  lines.push(``);
  writeFileSync(SUMMARY_PATH, lines.join("\n"));
}
