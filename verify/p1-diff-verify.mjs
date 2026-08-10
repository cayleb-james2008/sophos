// p1-diff-verify.mjs — targeted browser check for the P1 diff renderer.
// Starts the vite dev server (or reuses one on :1420), sends a message in
// browser-demo mode, and asserts the file-edit tool call renders a unified
// diff (green added / red removed lines) rather than raw JSON.
import { spawn, execFileSync } from "node:child_process";
import { chromium } from "playwright-core";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const REPO = process.cwd();
const APP_URL = "http://localhost:1420/";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log(`PASS  ${n}`); };
const bad = (n, d) => { fail++; console.log(`FAIL  ${n} — ${d}`); };
const check = (n, c, d) => (c ? ok(n) : bad(n, d || "condition false"));

async function ensureDevServer() {
  try { const r = await fetch(APP_URL); if (r.ok) return null; } catch {}
  const viteBin = join(REPO, "node_modules", "vite", "bin", "vite.js");
  const proc = spawn(process.execPath, [viteBin], { stdio: "ignore", detached: true });
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    try { const r = await fetch(APP_URL); if (r.ok) return proc; } catch {}
  }
  throw new Error("dev server did not start");
}

const devProc = await ensureDevServer();
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(APP_URL, { waitUntil: "networkidle" });
await page.waitForSelector("text=Conversation", { timeout: 30000 });
await page.waitForSelector("text=Engine Live", { timeout: 30000 });

// Send a message → the simulated turn includes a file-edit tool call.
const ta = page.locator('textarea[aria-label="Message input"]');
await ta.fill("show me a diff");
await ta.press("Enter");

// Wait for the diff to render.
await page.waitForSelector('[data-diff="true"]', { timeout: 20000 });
check("diff container rendered", true);

// File path shown in the diff header.
check("diff file path shown",
  await page.locator("text=src/features/chat/demo.ts").count() > 0);

// Added lines present + green-tinted (non-transparent background).
const addCount = await page.locator('[data-diff-add="true"]').count();
check("added lines present", addCount > 0, `addCount=${addCount}`);
const addBg = await page.locator('[data-diff-add="true"]').first().evaluate((el) => getComputedStyle(el).backgroundColor);
check("added line green-tinted", addBg !== "rgba(0, 0, 0, 0)" && addBg !== "transparent", `bg=${addBg}`);

// Removed lines present + red-tinted (the demo edit is a replacement).
const removeCount = await page.locator('[data-diff-remove="true"]').count();
check("removed lines present", removeCount > 0, `removeCount=${removeCount}`);
const removeBg = await page.locator('[data-diff-remove="true"]').first().evaluate((el) => getComputedStyle(el).backgroundColor);
check("removed line red-tinted", removeBg !== "rgba(0, 0, 0, 0)" && removeBg !== "transparent", `bg=${removeBg}`);

// Raw input JSON is collapsed behind the "input" button by default.
check("raw input JSON hidden by default",
  await page.locator("text=old_string").count() === 0);

// The non-edit echo tool call still renders raw input/output unchanged.
check("non-edit echo call still renders (demo_echo name)",
  await page.locator("text=demo_echo").count() > 0);

// Screenshot for evidence.
await page.screenshot({ path: join(REPO, "verify", "p1-diff-demo.png") });
console.log("SHOT  verify/p1-diff-demo.png");

console.log("\n================ RESULTS ================");
console.log(`PASS: ${pass}  FAIL: ${fail}`);
if (errors.length) { console.log("\n--- CONSOLE ERRORS ---"); errors.forEach((e) => console.log(e)); }
else console.log("No console JS errors.");

await browser.close();
if (devProc) { try { execFileSync("taskkill", ["/F", "/T", "/PID", String(devProc.pid)], { stdio: "ignore" }); } catch {} }
process.exit(fail > 0 || errors.length > 0 ? 1 : 0);
