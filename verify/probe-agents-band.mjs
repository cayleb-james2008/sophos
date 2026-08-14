// Dump the exact text + box of the ag-model band to resolve the "ed" fragment.
import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
async function startDevServer() {
  return new Promise((res, rej) => {
    const proc = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--port", "1423", "--strictPort"], { cwd: REPO, stdio: ["ignore","pipe","pipe"] });
    let buf = ""; const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
    proc.stdout.on("data", (d) => { buf += d.toString(); if (/localhost:1423/.test(strip(buf))) res({ proc, url: "http://localhost:1423" }); });
    proc.stderr.on("data", (d) => { buf += d.toString(); if (/localhost:1423/.test(strip(buf))) res({ proc, url: "http://localhost:1423" }); });
    setTimeout(() => rej(new Error("timeout")), 20000);
  });
}
async function main() {
  const dev = await startDevServer();
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto(dev.url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  await page.locator('aside button:has-text("Agents")').first().click().catch(()=>{});
  await page.waitForTimeout(700);
  const info = await page.locator(".ag-model").first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { text: el.innerText, width: Math.round(r.width), height: Math.round(r.height), outerHTML: el.outerHTML };
  }).catch(() => "<not found>");
  console.log("ag-model band:", JSON.stringify(info, null, 2));
  // Also check for any 'ed' standalone text node in the header.
  const headText = await page.locator(".ag-header, [class*='ag-headband']").first().innerText().catch(()=>"<not found>");
  console.log("header text:\n" + headText);
  await browser.close();
  dev.proc.kill();
}
main().catch(e => { console.error("ERR", e.message); process.exit(2); });
