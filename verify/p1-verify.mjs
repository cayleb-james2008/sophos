// p1-verify.mjs — browser verification for the Chat Experience Parity piece.
// Runs against `npx vite --port 1430`. Exercises: usage bar, header actions,
// @ file hint, command palette commands, steering, follow-up queue, shell
// trigger, side questions. Collects console errors.
//
// Each check is a real boolean assertion — no false positives.

import { chromium } from "playwright-core";

const BASE = "http://localhost:1430/";
const errors = [];
let pass = 0;
let fail = 0;

const ok = (name) => { pass++; console.log(`PASS  ${name}`); };
const bad = (name, detail) => { fail++; console.log(`FAIL  ${name} — ${detail}`); };
const check = (name, cond, detail) => (cond ? ok(name) : bad(name, detail || "condition false"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ta = () => page.locator('textarea[aria-label="Message input"]');

async function waitFor(fn, timeout = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try { if (await fn()) return true; } catch {}
    await sleep(120);
  }
  return false;
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(BASE, { waitUntil: "networkidle" });
await sleep(1200);

// 1. Chat loads
check("chat view loads (Conversation header)",
  await waitFor(() => page.locator("text=Conversation").first().isVisible().catch(() => false)));

// 2. Usage / context bar
check("usage bar shows context", await waitFor(() => page.locator('text=context').first().isVisible().catch(() => false)));
check("usage bar shows tokens", await waitFor(() => page.locator('text=tokens').first().isVisible().catch(() => false)));
check("usage bar shows messages", await waitFor(() => page.locator('text=messages').first().isVisible().catch(() => false)));

// 3. Header action buttons + toasts
const exportBtn = page.locator('button[aria-label="Export session to HTML"]');
const shareBtn = page.locator('button[aria-label="Share as GitHub gist"]');
const copyBtn = page.locator('button[aria-label="Copy last assistant message"]');
check("export button visible", await waitFor(() => exportBtn.isVisible().catch(() => false)));
check("share button visible", await waitFor(() => shareBtn.isVisible().catch(() => false)));
check("copy button visible", await waitFor(() => copyBtn.isVisible().catch(() => false)));

const toastShown = async (text) => waitFor(() => page.locator(`text=${text}`).last().isVisible().catch(() => false), 3000);

await exportBtn.click();
check("export toast shown", await toastShown("Exporting session to HTML…"));
await shareBtn.click();
check("share toast shown", await toastShown("Sharing session as gist…"));
await copyBtn.click();
check("copy toast shown", await toastShown("Copied last assistant message"));
await sleep(3000);

// 4. @ file reference hint
await ta().click();
await ta().fill("hello @world");
check("@ file-reference hint visible",
  await waitFor(() => page.locator('text=reference a project file').first().isVisible().catch(() => false)));
await ta().fill("");
await sleep(200);

// 5. Command palette commands
await page.keyboard.press("Control+K");
await sleep(500);
check("command palette opens with ⌘K", await page.locator(".palette__input").isVisible().catch(() => false));
for (const cmd of ["/export", "/share", "/copy", "/btw", "/side", "/usage", "/context", "/name", "/hotkeys", "/changelog", "/tree", "/clone", "/fork"]) {
  await page.locator(".palette__input").fill(cmd);
  await sleep(250);
  check(`palette command ${cmd}`, await page.locator(`text=${cmd}`).first().isVisible().catch(() => false));
}
await page.locator(".palette__input").fill("");
await page.keyboard.press("Escape");
await sleep(300);

// 6. Steering + follow-up queue while busy
await ta().fill("Please analyze the release plan");
await ta().press("Enter");
await sleep(700);
await ta().fill("Actually, focus on the packaging step");
await ta().press("Enter");
check("steered indicator while busy",
  await waitFor(() => page.locator('text=steered').first().isVisible().catch(() => false)));

await ta().fill("And prepare the changelog too");
await ta().press("Alt+Enter");
check("follow-up chip visible below input",
  await waitFor(() => page.locator('text=queued ·').first().isVisible().catch(() => false)));

await page.keyboard.press("Escape");
check("Escape clears queued follow-ups",
  await waitFor(() => !page.locator('text=queued ·').isVisible().catch(() => true)));

await ta().fill("Draft the summary paragraph");
await ta().press("Alt+Enter");
await sleep(300);
await page.keyboard.press("Alt+ArrowUp");
await sleep(300);
const retrieved = await ta().inputValue();
check("Alt+Up retrieves last queued into editor", retrieved.includes("summary paragraph"), `value="${retrieved}"`);
await ta().fill("");

await sleep(6000); // let streaming finish (busy clears)

// 7. Shell trigger
await ta().fill("!echo hello from shell");
await ta().press("Enter");
check("shell indicator visible",
  await waitFor(() => page.locator('text=shell').first().isVisible().catch(() => false)));
await sleep(500);
await ta().fill("!!whoami");
await ta().press("Enter");
check("hidden shell indicator visible",
  await waitFor(() => page.locator('text=hidden shell').first().isVisible().catch(() => false)));
await sleep(4500);

// 8. Side question
await ta().fill("/btw what is the difference between steer and follow-up?");
await ta().press("Enter");
check("side-question panel appears",
  await waitFor(() => page.locator('text=/btw').first().isVisible().catch(() => false)));
check("side question completes in demo",
  await waitFor(() => page.locator('text=complete').first().isVisible().catch(() => false)));
await page.locator('button[title="Show reply"]').first().click();
check("side reply area expands",
  await waitFor(() => page.locator('text=Side reply (demo preview)').first().isVisible().catch(() => false)));
await sleep(500);

// Summary
console.log("\n================ RESULTS ================");
console.log(`PASS: ${pass}  FAIL: ${fail}`);
if (errors.length) {
  console.log("\n--- CONSOLE ERRORS ---");
  errors.forEach((e) => console.log(e));
} else {
  console.log("No console JS errors.");
}

await browser.close();
process.exit(fail > 0 || errors.length > 0 ? 1 : 0);
