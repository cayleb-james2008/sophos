// verify/e2e/helpers.mjs — shared harness for the browser-driven e2e suite.
// Drives an owned ephemeral Vite server with Playwright-core against the system
// Chrome. No agent-browser daemon — Playwright directly.
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

export const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
export const REPO = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
export const SHOT_DIR = join(REPO, "verify", "e2e", "screenshots");
export const REPORT_PATH = join(REPO, "verify", "e2e", "e2e-report.json");
export const SUMMARY_PATH = join(REPO, "verify", "e2e", "e2e-summary.md");

mkdirSync(SHOT_DIR, { recursive: true });

/** Hard timeout helper — never hangs forever. */
export const HARD = 30000;

/** Reserve an ephemeral loopback port without touching a caller-owned server. */
export async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("could not determine an ephemeral port")));
        return;
      }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

/**
 * Start and own a Vite server for the mock browser suite.
 *
 * This intentionally never probes or reuses port 1420: a responding process
 * there may belong to another worktree. The returned process is the only
 * process this harness is allowed to stop.
 */
export async function startOwnedDevServer() {
  const port = await freePort();
  const viteBin = join(REPO, "node_modules", "vite", "bin", "vite.js");
  const proc = spawn(process.execPath, [viteBin, "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: REPO,
    stdio: "ignore",
    windowsHide: true,
  });
  const url = `http://127.0.0.1:${port}/`;
  for (let attempt = 0; attempt < 30; attempt++) {
    if (proc.exitCode !== null) throw new Error(`owned Vite server exited before becoming ready (code ${proc.exitCode})`);
    try {
      const response = await fetch(url);
      if (response.ok) return { proc, url, port };
    } catch {
      // The owned process may still be binding its ephemeral port.
    }
    await sleep(250);
  }
  await stopOwnedDevServer({ proc, url, port });
  throw new Error(`owned Vite server did not start on ${url}`);
}

/** Stop only the Vite process previously returned by startOwnedDevServer. */
export async function stopOwnedDevServer(server) {
  if (!server?.proc || server.proc.exitCode !== null) return;
  if (process.platform === "win32" && server.proc.pid) {
    try { execFileSync("taskkill", ["/F", "/T", "/PID", String(server.proc.pid)], { stdio: "ignore", timeout: 8000 }); } catch {}
  } else {
    try { server.proc.kill("SIGTERM"); } catch {}
  }
}

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
  let browser;
  try {
    browser = await chromium.launch({
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
  } catch (error) {
    try { await browser?.close(); } catch {}
    throw error;
  }
}

/** Navigate to the app and wait for the shell to render. */
export async function gotoApp(page, appUrl) {
  if (!appUrl) throw new Error("gotoApp requires the URL returned by startOwnedDevServer");
  await page.goto(appUrl, { waitUntil: "networkidle", timeout: HARD });
  await page.waitForSelector("text=Conversation", { timeout: HARD });
  // This suite is deliberately browser-demo only. A real Tauri page must use
  // the live-daemon harnesses instead of silently passing mock assertions.
  const tauriRuntime = await page.evaluate(() => "__TAURI_INTERNALS__" in window);
  if (tauriRuntime) throw new Error("browser suite attached to a Tauri runtime; expected MockIpcClient preview");
  await page.waitForSelector("text=Demo mode — engine not connected", { timeout: HARD });
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

/** Write the machine-readable JSON report. */
export function writeReport(harness, meta) {
  const passed = harness.results.filter((r) => r.ok).length;
  const failed = harness.results.filter((r) => !r.ok).length;
  const report = {
    suite: "sophos-browser-e2e",
    mode: "browser-demo (MockIpcClient)",
    app: { url: meta.appUrl, devServer: "owned ephemeral Vite server", mode: "browser-demo (MockIpcClient)" },
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
  lines.push(`Date: ${new Date().toISOString()} · Mode: browser-demo (MockIpcClient) · App: owned ephemeral Vite server`);
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
