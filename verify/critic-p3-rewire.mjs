#!/usr/bin/env node
/**
 * Critic re-verification (P3 rework) — independent of the worker's harness.
 * Confirms the corrected wiring: panel actions now invoke ipc.prompt with the
 * TUI slash command, and W4 (daemon-unreachable) shows a banner + no unhandled
 * rejection. Records every prompt() invocation via a prototype patch.
 */
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright-core";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 1434;
const URL = `http://localhost:${PORT}`;
const CHROME = "C:/Users/Cayleb/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe";

const results = [];
const rec = (n, ok, d = "") => { results.push({ n, ok, d }); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };
let vite;
async function startVite() {
  const viteBin = join(REPO, "node_modules", "vite", "bin", "vite.js");
  vite = spawn(process.execPath, [viteBin, "--port", String(PORT), "--strictPort"], { cwd: REPO, stdio: ["ignore", "pipe", "pipe"] });
  for (let i = 0; i < 60; i++) { try { const r = await fetch(URL); if (r.ok) return; } catch {} await sleep(500); }
  throw new Error("vite did not come up");
}

async function main() {
  await startVite();
  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push("PAGEERROR: " + e));

  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const clickText = async (t) => { const el = page.locator(`button:has-text("${t}")`).first(); await el.waitFor({ state: "visible", timeout: 8000 }); await el.click(); await page.waitForTimeout(300); };

  // Patch prompt to RECORD invocations and succeed (simulate a reachable daemon
  // that accepts the command).
  await page.evaluate(async () => {
    const mod = await import("/src/ipc/client.ts");
    window.__prompts = [];
    mod.MockIpcClient.prototype.prompt = async function (text) {
      window.__prompts.push(String(text));
    };
  });
  await clickText("Settings"); await page.waitForTimeout(400);
  await clickText("Advanced"); await page.waitForTimeout(400);
  await clickText("Long-running"); await page.waitForTimeout(400);
  await clickText("Goals"); await page.waitForTimeout(300);

  await page.locator('input[placeholder*="Ship the release"]').first().fill("Ship v2");
  await page.locator('form:has(input[placeholder*="Ship the release"]) button:has-text("Set")').first().click();
  await page.waitForTimeout(300);
  let ps = await page.evaluate(() => window.__prompts);
  rec("Goals Set → ipc.prompt('/goal <objective>')", ps.some((p) => p.startsWith("/goal ") && p.includes("Ship v2")), JSON.stringify(ps));
  rec("Goals Set → optimistic row appears", (await page.locator('text=Ship v2').count()) > 0);

  await clickText("Autonomous"); await page.waitForTimeout(300);
  await page.locator('input[placeholder="e.g. 20"]').fill("12");
  await clickText("Start autonomous"); await page.waitForTimeout(300);
  ps = await page.evaluate(() => window.__prompts);
  rec("Autonomous Start → ipc.prompt('/autonomous on')", ps.some((p) => p === "/autonomous on"), JSON.stringify(ps));

  await clickText("Heartbeats"); await page.waitForTimeout(300);
  await page.locator('input[placeholder*="every 5 minutes"]').fill("every 5m");
  await clickText("Set heartbeat"); await page.waitForTimeout(300);
  ps = await page.evaluate(() => window.__prompts);
  rec("Heartbeat Set → ipc.prompt('/heartbeat every 5m')", ps.some((p) => p === "/heartbeat every 5m"), JSON.stringify(ps));

  await clickText("Schedules"); await page.waitForTimeout(300);
  await page.locator('input[placeholder*="0 9"]').fill("0 9 * * 1-5");
  await page.locator('input[placeholder*="Review open work"]').fill("review");
  await clickText("Add schedule"); await page.waitForTimeout(300);
  ps = await page.evaluate(() => window.__prompts);
  rec("Schedule Add → ipc.prompt('/schedule add ... -- ...')", ps.some((p) => p.includes("/schedule add") && p.includes("0 9 * * 1-5") && p.includes("review")), JSON.stringify(ps));

  await clickText("Refinement"); await page.waitForTimeout(300);
  await clickText("Refine now"); await page.waitForTimeout(300);
  // bare refine calls ipc.refine() (first-class RPC) — prompt should NOT include "/refine"
  ps = await page.evaluate(() => window.__prompts);
  rec("Refinement bare → uses ipc.refine() (no /refine prompt)", !ps.some((p) => p.startsWith("/refine")), JSON.stringify(ps));

  // ---- W4 re-verification: force prompt to reject, banner + no unhandled ----
  await clickText("Goals"); await page.waitForTimeout(300);
  const beforeErr = consoleErrors.length;
  await page.evaluate(async () => {
    const mod = await import("/src/ipc/client.ts");
    mod.MockIpcClient.prototype.prompt = async () => { throw new Error("no active daemon connection"); };
  });
  await page.locator('input[placeholder*="Ship the release"]').first().fill("W4b");
  await page.locator('form:has(input[placeholder*="Ship the release"]) button:has-text("Set")').first().click();
  await page.waitForTimeout(400);
  const banner = page.locator('[role="alert"]').first();
  const bannerShown = await banner.isVisible().catch(() => false);
  const bannerText = bannerShown ? ((await banner.textContent().catch(() => "")) ?? "") : "";
  rec("W4: inline error banner on prompt reject", bannerShown && /daemon|connection|goal/i.test(bannerText), bannerText.slice(0, 80));
  const unhandled = consoleErrors.slice(beforeErr).filter((e) => /Uncaught|unhandled|rejection/i.test(String(e)));
  rec("W4: no unhandled rejection on prompt reject", unhandled.length === 0, JSON.stringify(unhandled));

  console.log("\nconsole errors (non-favicon):", consoleErrors.filter((e) => !e.includes("favicon")).length ? JSON.stringify(consoleErrors) : "none");
  await browser.close();
  try { vite?.kill("SIGKILL"); } catch {}
}
main().catch(async (e) => { console.error("crashed:", e); try { vite?.kill("SIGKILL"); } catch {} process.exit(2); });
