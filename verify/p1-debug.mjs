import { chromium } from "playwright-core";
const page = await (await chromium.launch({ headless: true })).newPage({ viewport: { width: 1280, height: 860 } });
page.on("console", m => { if (m.type() === "error") console.log("CONSOLE-ERR:", m.text()); });
page.on("pageerror", e => console.log("PAGE-ERR:", String(e)));
await page.goto("http://localhost:1430/", { waitUntil: "networkidle" });
await new Promise(r => setTimeout(r, 1200));
const ta = () => page.locator('textarea[aria-label="Message input"]');

// clipboard test
await ta().click();
await ta().fill("test message");
await ta().press("Enter");
await new Promise(r => setTimeout(r, 2000));
const lastAssistant = await page.evaluate(async () => {
  try {
    await navigator.clipboard.writeText("hello");
    return "clipboard-ok";
  } catch (e) {
    return "clipboard-err:" + (e?.name || e?.message || String(e));
  }
});
console.log("CLIPBOARD:", lastAssistant);

// Escape test
const cpBtn = page.locator('button[aria-label="Copy last assistant message"]');
await cpBtn.click();
await new Promise(r => setTimeout(r, 300));
// queue a follow-up via Alt+Enter
await ta().fill("queue this");
await ta().press("Alt+Enter");
await new Promise(r => setTimeout(r, 300));
console.log("chip visible before esc:", await page.locator('text=queued ·').first().isVisible().catch(()=>false));
console.log("focused element:", await page.evaluate(() => document.activeElement?.tagName + ":" + document.activeElement?.getAttribute("aria-label")));
await ta().press("Escape");
await new Promise(r => setTimeout(r, 300));
console.log("chip visible after esc (ta.press):", await page.locator('text=queued ·').first().isVisible().catch(()=>false));
await page.keyboard.press("Escape");
await new Promise(r => setTimeout(r, 300));
console.log("chip visible after esc (kb.press):", await page.locator('text=queued ·').first().isVisible().catch(()=>false));
await page.close();
