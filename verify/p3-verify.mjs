#!/usr/bin/env node
/**
 * verify/p3-verify.mjs — headless browser verification for the P3 long-running
 * features UI (GoalsPanel + AutonomousPanel + HeartbeatsPanel + SchedulesPanel +
 * RefinementHistory + AdvancedPanel "Long-running" section).
 *
 *  1. boots `npx vite --port 1432` (browser/demo mode, MockIpcClient)
 *  2. drives the app: Settings → Advanced → Long-running, exercising each panel
 *  3. asserts each panel's key elements render and interactions run cleanly
 *  4. collects console/page errors (must be zero)
 *
 * Outputs screenshots to verify/p3/ and a JSON report to verify/p3-report.json.
 * Exit 0 iff all checks pass.
 */
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright-core";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 1432;
const URL = `http://localhost:${PORT}`;
const CHROME = process.env.CHROME_EXE || "C:/Users/Cayleb/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe";

const outDir = join(REPO, "verify", "p3");
mkdirSync(outDir, { recursive: true });

const report = { startedAt: new Date().toISOString(), checks: [], errors: [] };
const rec = (name, ok, detail = "") => {
  report.checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};
const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];

let vite;
async function startVite() {
  const viteBin = join(REPO, "node_modules", "vite", "bin", "vite.js");
  vite = spawn(process.execPath, [viteBin, "--port", String(PORT), "--strictPort"], {
    cwd: REPO,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  vite.stdout?.on("data", (d) => (log += d.toString()));
  vite.stderr?.on("data", (d) => (log += d.toString()));
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(URL);
      if (r.ok) return;
    } catch {}
    await sleep(500);
  }
  throw new Error("vite did not come up:\n" + log.slice(-2000));
}

async function main() {
  await startVite();
  console.log(`vite up on ${URL}`);
  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push({ text: m.text(), url: m.location()?.url });
  });
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("response", (r) => {
    if (r.status() >= 400) failedRequests.push({ status: r.status(), url: r.url() });
  });

  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200); // allow mock connection snapshot

  const byText = (text) => page.getByText(text, { exact: false });
  const clickText = async (text) => {
    const el = page.locator(`button:has-text("${text}")`).first();
    await el.waitFor({ state: "visible", timeout: 8000 });
    await el.click();
    await page.waitForTimeout(300);
  };

  // ---- Navigate to Settings → Advanced → Long-running ----
  await clickText("Settings");
  await page.waitForTimeout(500);
  await clickText("Advanced");
  await page.waitForTimeout(500);
  await clickText("Long-running");
  await page.waitForTimeout(500);

  // ---- Goals ----
  await clickText("Goals");
  await page.waitForTimeout(400);
  const goalInput = page.locator('input[placeholder*="Ship the release"]').first();
  rec("Goals: 'Set goal' input renders", await goalInput.isVisible().catch(() => false));
  rec("Goals: active goal from mock renders", (await byText("Ship the release and verify every published artifact").count()) > 0);
  // exercise set-goal — scope the button to the goal form (avoid sidebar "Settings")
  await goalInput.fill("Migrate the legacy config schema");
  await page.locator('form:has(input[placeholder*="Ship the release"]) button:has-text("Set")').first().click();
  await page.waitForTimeout(300);
  rec("Goals: set-goal adds a goal row", (await byText("Migrate the legacy config schema").count()) > 0);
  await page.screenshot({ path: join(outDir, "goals.png") });

  // ---- Autonomous ----
  await clickText("Autonomous");
  await page.waitForTimeout(400);
  rec("Autonomous: budget inputs render", (await page.locator('input[placeholder="e.g. 20"]').count()) > 0);
  rec("Autonomous: Start button renders", (await page.locator('button:has-text("Start autonomous")').count()) > 0);
  await page.locator('input[placeholder="e.g. 20"]').fill("25");
  await clickText("Start autonomous");
  await page.waitForTimeout(300);
  rec("Autonomous: starts → Stop button appears", (await page.locator('button:has-text("Stop autonomous")').count()) > 0);
  await page.screenshot({ path: join(outDir, "autonomous.png") });
  await clickText("Stop autonomous");
  await page.waitForTimeout(200);

  // ---- Heartbeats ----
  await clickText("Heartbeats");
  await page.waitForTimeout(400);
  rec("Heartbeats: empty state renders", (await byText("No heartbeats set").count()) > 0);
  await page.locator('input[placeholder*="every 5 minutes"]').fill("every 5 minutes");
  await clickText("Set heartbeat");
  await page.waitForTimeout(300);
  rec("Heartbeats: add creates a heartbeat row", (await page.locator('text=every 5 minutes').count()) > 0);
  await page.screenshot({ path: join(outDir, "heartbeats.png") });

  // ---- Schedules ----
  await clickText("Schedules");
  await page.waitForTimeout(400);
  rec("Schedules: empty state renders", (await byText("No schedules").count()) > 0);
  await page.locator('input[placeholder*="0 9"]').fill("0 9 * * 1-5");
  await page.locator('input[placeholder*="Review open work"]').fill("Review open work");
  await clickText("Add schedule");
  await page.waitForTimeout(300);
  rec("Schedules: add creates a schedule row", (await page.locator('text=0 9 * * 1-5').count()) > 0);
  await page.screenshot({ path: join(outDir, "schedules.png") });

  // ---- Refinement ----
  await clickText("Refinement");
  await page.waitForTimeout(400);
  rec("Refinement: empty state renders", (await byText("No refinements yet").count()) > 0);
  rec("Refinement: 'Refine now' button renders", (await page.locator('button:has-text("Refine now")').count()) > 0);
  await clickText("Refine now");
  await page.waitForTimeout(300);
  rec("Refinement: refine now adds an entry", (await page.locator('text=Refined on request').count()) > 0);
  await page.screenshot({ path: join(outDir, "refinement.png") });

  // ---- Runtime telemetry still intact ----
  await clickText("Runtime telemetry");
  await page.waitForTimeout(400);
  rec("Advanced: runtime telemetry still renders", (await byText("Daemon diagnostics").count()) > 0);
  await page.screenshot({ path: join(outDir, "runtime.png") });

  // ---- W4: daemon-unreachable → inline error banner, no unhandled rejection ----
  await clickText("Long-running");
  await page.waitForTimeout(300);
  await clickText("Goals");
  await page.waitForTimeout(300);
  // Force the mock's prompt to reject, simulating an unreachable daemon
  // (the real bridge requireConn() throws "no active daemon connection").
  // GoalsPanel now routes "set goal" through ipc.prompt("/goal ...").
  await page.evaluate(async () => {
    const mod = await import("/src/ipc/client.ts");
    mod.MockIpcClient.prototype.prompt = async () => {
      throw new Error("no active daemon connection");
    };
  });
  const beforeErr = consoleErrors.length;
  const beforePageErr = pageErrors.length;
  await page.locator('input[placeholder*="Ship the release"]').fill("W4 probe goal");
  await page.locator('form:has(input[placeholder*="Ship the release"]) button:has-text("Set")').first().click();
  await page.waitForTimeout(400);
  // The banner shows the informative raw bridge error ("no active daemon
  // connection") in a role=alert element.
  const alertBanner = page.locator('[role="alert"]').first();
  const bannerShown = await alertBanner.isVisible().catch(() => false);
  const bannerText = bannerShown ? (await alertBanner.textContent().catch(() => "")) ?? "" : "";
  rec("W4: daemon-unreachable shows inline error banner", bannerShown && /daemon|goal|connection/i.test(bannerText));
  const unhandled = consoleErrors
    .slice(beforeErr)
    .filter((e) => typeof e === "object" && e.text && /Uncaught|unhandled|rejection/i.test(e.text));
  rec("W4: no unhandled promise rejection on daemon-unreachable", unhandled.length === 0 && pageErrors.length === beforePageErr);
  await page.screenshot({ path: join(outDir, "w4-daemon-unreachable.png") });

  await browser.close();
  try { vite?.kill("SIGKILL"); } catch {}
}

main()
  .then(() => {
  const isFavicon = (e) => typeof e === "object" && e.text && e.text.includes("404") && (e.url || "").includes("favicon");
  const realConsoleErrors = consoleErrors.filter((e) => !isFavicon(e));
  const realFailed = failedRequests.filter((r) => !r.url.includes("favicon"));
  report.consoleErrors = consoleErrors;
  report.pageErrors = pageErrors;
  report.failedRequests = failedRequests;
  report.ok = report.checks.every((c) => c.ok) && realConsoleErrors.length === 0 && realFailed.length === 0 && pageErrors.length === 0;
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(REPO, "verify", "p3-report.json"), JSON.stringify(report, null, 2));
  console.log("console errors:", consoleErrors.length ? JSON.stringify(consoleErrors, null, 2) : "none");
  console.log("failed requests:", failedRequests.length ? JSON.stringify(failedRequests, null, 2) : "none");
    console.log(`overall: ${report.ok ? "PASS" : "FAIL"}`);
    process.exit(report.ok ? 0 : 1);
  })
  .catch(async (e) => {
    report.finishedAt = new Date().toISOString();
    report.ok = false;
    report.fatal = String(e);
    writeFileSync(join(REPO, "verify", "p3-report.json"), JSON.stringify(report, null, 2));
    console.error("harness crashed:", e);
    try { vite?.kill("SIGKILL"); } catch {}
    process.exit(2);
  });
