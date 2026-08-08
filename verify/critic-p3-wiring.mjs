#!/usr/bin/env node
/**
 * Critic probe (P3) — independent of the worker's harness.
 * Proves whether panel ACTIONS drive anything durable, or are pure ephemeral
 * local React state in browser/demo mode (MockIpcClient.runCommand is a no-op).
 *
 *  1. boots vite on :1433
 *  2. Settings → Advanced → Long-running
 *  3. Goals tab: create a goal, switch to Autonomous, switch back — does it persist?
 *  4. Instruments window to capture whether any real IPC/network happens on action.
 */
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright-core";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 1433;
const URL = `http://localhost:${PORT}`;
const CHROME = "C:/Users/Cayleb/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe";

const results = [];
const rec = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`); };

let vite;
async function startVite() {
  const viteBin = join(REPO, "node_modules", "vite", "bin", "vite.js");
  vite = spawn(process.execPath, [viteBin, "--port", String(PORT), "--strictPort"], { cwd: REPO, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  vite.stdout?.on("data", (d) => (log += d.toString()));
  vite.stderr?.on("data", (d) => (log += d.toString()));
  for (let i = 0; i < 60; i++) { try { const r = await fetch(URL); if (r.ok) return; } catch {} await sleep(500); }
  throw new Error("vite did not come up:\n" + log.slice(-2000));
}

async function main() {
  await startVite();
  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push("PAGEERROR: " + e));

  // Instrument: capture every fetch / XHR / postMessage — does a panel action
  // cause ANY network or IPC transport activity?
  await page.addInitScript(() => {
    window.__net = [];
    const of = window.fetch.bind(window);
    window.fetch = async (...a) => { window.__net.push("fetch " + String(a[0])); return of(...a); };
    const oX = window.XMLHttpRequest.prototype.open;
    window.XMLHttpRequest.prototype.open = function (...a) { window.__net.push("xhr " + a[1]); return oX.apply(this, a); };
  });

  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const clickText = async (text) => { const el = page.locator(`button:has-text("${text}")`).first(); await el.waitFor({ state: "visible", timeout: 8000 }); await el.click(); await page.waitForTimeout(300); };

  await clickText("Settings"); await page.waitForTimeout(400);
  await clickText("Advanced"); await page.waitForTimeout(400);
  await clickText("Long-running"); await page.waitForTimeout(400);
  await clickText("Goals"); await page.waitForTimeout(400);

  // Count goals before
  const goalRowsBefore = await page.locator('button:has-text("Clear")').count();

  // Create a goal
  await page.locator('input[placeholder*="Ship the release"]').first().fill("CRITIC-PERSIST-TEST");
  await page.locator('form:has(input[placeholder*="Ship the release"]) button:has-text("Set")').first().click();
  await page.waitForTimeout(300);
  const afterSet = await page.locator('text=CRITIC-PERSIST-TEST').count();
  rec("Goals: created goal appears immediately (optimistic)", afterSet > 0);

  // Network activity on Set?
  const netAfterSet = await page.evaluate(() => window.__net.slice());
  rec("Goals: 'Set goal' caused NO network/IPC transport", netAfterSet.length === 0, JSON.stringify(netAfterSet));

  // Switch away (Autonomous) and back (Goals) — does the created goal survive?
  await clickText("Autonomous"); await page.waitForTimeout(300);
  await clickText("Goals"); await page.waitForTimeout(400);
  const afterRoundTrip = await page.locator('text=CRITIC-PERSIST-TEST').count();
  rec("Goals: created goal SURVIVES tab switch (persisted)", afterRoundTrip > 0, `rows after roundtrip=${afterRoundTrip}`);

  // Pause a goal — does it survive a round trip?
  const pauseBtn = page.locator('button:has-text("Pause")').first();
  const hadPause = await pauseBtn.count();
  if (hadPause > 0) { await pauseBtn.click(); await page.waitForTimeout(200); }
  await clickText("Autonomous"); await page.waitForTimeout(200);
  await clickText("Goals"); await page.waitForTimeout(300);
  const pauseAfter = await page.locator('button:has-text("Pause")').count();
  const resumeAfter = await page.locator('button:has-text("Resume")').count();
  rec("Goals: Pause action persists across tab switch", resumeAfter > 0, `pause=${pauseAfter} resume=${resumeAfter}`);

  console.log("\nconsole/page errors:", consoleErrors.length ? JSON.stringify(consoleErrors, null, 2) : "none");
  await browser.close();
  try { vite?.kill("SIGKILL"); } catch {}
}

main().catch(async (e) => { console.error("probe crashed:", e); try { vite?.kill("SIGKILL"); } catch {} process.exit(2); });
