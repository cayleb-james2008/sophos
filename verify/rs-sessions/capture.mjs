#!/usr/bin/env node
/**
 * verify/rs-sessions/capture.mjs — capture the Sessions view (graph + detail)
 * to verify/rs-sessions/ for a judgeable before/after of the redesign.
 *
 * Usage: node verify/rs-sessions/capture.mjs <out.png> [--detail]
 * Starts the dev server if it isn't running, drives the app with Playwright-core
 * against the system Chrome, navigates to the Sessions view and saves a screenshot.
 * Kills the dev server + headless Chrome on exit (browser hygiene).
 */
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright-core";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..", "..");
const MODULES = resolve(__dirname, "..", "..", "node_modules");
const APP_URL = "http://localhost:1420/";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const OUT = resolve(REPO, process.argv[2] || "verify/rs-sessions/sessions.png");
const DETAIL = process.argv.includes("--detail");

async function ensureDevServer() {
  try {
    const r = await fetch(APP_URL);
    if (r.ok) return null;
  } catch {}
  const viteBin = join(MODULES, "vite", "bin", "vite.js");
  const proc = spawn(process.execPath, [viteBin], { stdio: "ignore", detached: true });
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    try { const r = await fetch(APP_URL); if (r.ok) return proc; } catch {}
  }
  throw new Error("dev server did not start on " + APP_URL);
}

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
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--disable-gpu", "--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 980 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(APP_URL, { wait_until: "networkidle", timeout: 30000 });
    await sleep(1800);
    try {
      await page.getByRole("button", { name: "Sessions", exact: true }).first().click({ timeout: 8000 });
      await page.mouse.move(1600, 950);
    } catch {}
    await sleep(1500);
    if (DETAIL) {
      const nodes = page.locator(".react-flow__node");
      const n = await nodes.count();
      if (n > 0) {
        try { await nodes.first().click({ timeout: 4000 }); } catch {}
        await sleep(700);
      }
    }
    await page.screenshot({ path: OUT });
    console.log("saved:", OUT);
    if (errors.length) console.log("console errors:", errors);
  } finally {
    await browser.close();
    if (devProc) {
      try { execFileSync("taskkill", ["/F", "/T", "/PID", String(devProc.pid)], { stdio: "ignore", timeout: 8000 }); } catch {}
    }
    killStrayChrome();
  }
}

main().catch((e) => { console.error("capture crashed:", e); process.exit(2); });
