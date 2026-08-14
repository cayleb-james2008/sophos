#!/usr/bin/env node
// Targeted DOM probe to verify the vision critic's 3 defects against the
// actual rendered state. Runs the dev server, navigates to Chat + Agents,
// and dumps the exact outerHTML of the SystemBar readout, the ModelSelector
// root, and the ContextBar — plus computed styles of the cost value.
import { spawn } from "node:child_process";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

async function startDevServer() {
  return new Promise((res, rej) => {
    const proc = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--port", "1422", "--strictPort"], { cwd: REPO, stdio: ["ignore","pipe","pipe"] });
    let buf = "";
    const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
    proc.stdout.on("data", (d) => { buf += d.toString(); if (/localhost:1422/.test(strip(buf))) res({ proc, url: "http://localhost:1422" }); });
    proc.stderr.on("data", (d) => { buf += d.toString(); if (/localhost:1422/.test(strip(buf))) res({ proc, url: "http://localhost:1422" }); });
    setTimeout(() => rej(new Error("dev server timeout\n"+buf)), 20000);
  });
}

async function main() {
  const dev = await startDevServer();
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(dev.url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);

  // Navigate to Chat.
  await page.locator('aside button:has-text("Chat")').first().click().catch(()=>{});
  await page.waitForTimeout(600);

  console.log("=== CHAT: SystemBar readout outerHTML (cost cell) ===");
  const readout = await page.locator(".system-bar__readout").first().innerHTML().catch(() => "<not found>");
  console.log(readout);

  console.log("\n=== CHAT: SystemBar cost value computed color ===");
  const costColor = await page.locator(".system-bar__cost-value").first().evaluate((el) => {
    const cs = getComputedStyle(el);
    return { color: cs.color, background: cs.backgroundColor };
  }).catch(() => "<not found>");
  console.log(JSON.stringify(costColor));

  console.log("\n=== CHAT: ModelSelector root (inline row + fast toggle) outerHTML ===");
  const msRoot = await page.locator(".ms-root").first().innerHTML().catch(() => "<not found>");
  console.log(msRoot.slice(0, 2500));

  console.log("\n=== CHAT: ms-fast-toggle present? ===");
  const fastCount = await page.locator(".ms-fast-toggle").count();
  const fastHtml = fastCount > 0 ? await page.locator(".ms-fast-toggle").first().innerHTML() : "<absent>";
  console.log("count=" + fastCount + " html=" + fastHtml.slice(0,400));

  console.log("\n=== CHAT: context-bar present? outerHTML ===");
  const ctxCount = await page.locator(".context-bar").count();
  const ctxHtml = ctxCount > 0 ? await page.locator(".context-bar").first().innerHTML() : "<absent>";
  console.log("count=" + ctxCount);
  console.log(ctxHtml.slice(0, 1200));

  console.log("\n=== CHAT: is there a first-run banner hiding the composer? ===");
  const firstRun = await page.locator('[class*="first-run"]').count();
  const composer = await page.locator('.chat-composer, [class*="composer"]').count();
  console.log("first-run-banner=" + firstRun + " composer=" + composer);

  // Check the screenshot banner text the critic quoted ("OPEN INTELLIGENCE WORKSPACE", "think.", "Preview workspace")
  console.log("\n=== CHAT: headline text present? ===");
  const bodyText = await page.locator("body").innerText().catch(() => "");
  for (const t of ["OPEN INTELLIGENCE", "think.", "Preview workspace", "Start a session"]) {
    console.log(`  "${t}": ${bodyText.includes(t) ? "YES" : "no"}`);
  }

  // Agents view — the RUNTIME MODEL overlap.
  await page.locator('aside button:has-text("Agents")').first().click().catch(()=>{});
  await page.waitForTimeout(600);
  console.log("\n=== AGENTS: header area (look for RUNTIME MODEL + model selector) ===");
  const agentsHeader = await page.locator('[data-view-header], .agents-header, .agents h2, [class*="agents"] header').first().innerHTML().catch(() => "<not found>");
  console.log(agentsHeader.slice(0, 1500));
  console.log("\n=== AGENTS: any 'RUNTIME MODEL' text? ===");
  const rm = await page.locator(":has-text('RUNTIME MODEL'), :has-text('Runtime Model')").count().catch(()=>0);
  console.log("RUNTIME MODEL count=" + rm);
  // grep the agents-view root text for the "ed" fragment context
  const agentsText = await page.locator('main').innerText().catch(() => "");
  const idx = agentsText.indexOf("MODEL");
  if (idx >= 0) console.log("context around MODEL: ...'" + agentsText.slice(Math.max(0,idx-40), idx+60).replace(/\s+/g," ") + "'...");

  await browser.close();
  dev.proc.kill();
}
main().catch(async (e) => { console.error("ERR", e.message); process.exit(2); });
