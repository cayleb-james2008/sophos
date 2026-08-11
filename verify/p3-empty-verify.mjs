// verify/p3-empty-verify.mjs — P3 empty-state + first-message onboarding check.
// Drives the LIVE dev server (:1420, MockIpcClient) with a fresh browser.
// Verifies: empty state with starter prompts, prompt→composer fill, sending a
// message hides the empty state, FirstRunBanner steps, and the localStorage flag.
import { chromium } from "playwright-core";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const URL = "http://localhost:1420/";

const results = [];
const rec = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}  — ${detail}`); };

const browser = await chromium.launch({
  channel: "chrome", headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--disable-background-timer-throttling"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message));

await page.goto(URL, { waitUntil: "networkidle", timeout: 30000 });
// Clear localStorage, reload for a pristine first-run.
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector("text=Conversation", { timeout: 30000 });
await page.waitForTimeout(1200);

// 1. Empty state + starter prompts.
const emptyState = await page.locator("text=Start a conversation").count();
const starterCount = await page.locator('button[aria-label^="Starter prompt:"]').count();
rec("empty state shows with provider connected", emptyState > 0, `'Start a conversation'=${emptyState}`);
rec("4 starter prompts present", starterCount === 4, `starter prompt buttons=${starterCount}`);

// 2. FirstRunBanner step 2 ("ready" — provider connected, no message yet).
const ready = await page.locator("text=You're ready").count();
const startBtn = await page.locator('button:has-text("Start chatting")').count();
rec("FirstRunBanner 'ready' step shown", ready > 0 && startBtn > 0, `'You're ready'=${ready}, Start chatting=${startBtn}`);

// 3. Clicking a starter prompt fills the composer (no auto-send).
const promptText = "Explain this codebase";
await page.locator(`button[aria-label="Starter prompt: ${promptText}"]`).click();
await page.waitForTimeout(300);
const composerVal = await page.locator('textarea[aria-label="Message input"]').inputValue();
rec("starter prompt fills composer (no auto-send)", composerVal === promptText, `composer='${composerVal}'`);

// 4. Send a message → empty state hides, banner completes.
await page.locator('textarea[aria-label="Message input"]').fill("hello p3");
await page.locator('textarea[aria-label="Message input"]').press("Enter");
await page.waitForSelector("text=hello p3", { timeout: 15000 });
await page.waitForTimeout(1200);
const emptyAfter = await page.locator("text=Start a conversation").count();
const readyAfter = await page.locator("text=You're ready").count();
rec("empty state hidden after first message", emptyAfter === 0, `'Start a conversation' after send=${emptyAfter}`);
rec("FirstRunBanner completed (hidden)", readyAfter === 0, `'You're ready' after send=${readyAfter}`);

// 5. localStorage flag set.
const flag = await page.evaluate(() => localStorage.getItem("sophos.hasFirstMessage.v1"));
rec("localStorage first-message flag set", flag === "1", `sophos.hasFirstMessage.v1='${flag}'`);

// 6. Screenshot of the post-send transcript (best-effort — headless surface
//    can be flaky; never fails the run).
await page.waitForSelector("text=Got it — you said", { timeout: 15000 }).catch(() => {});
try { await page.screenshot({ path: "verify/p3-empty-after-send.png" }); } catch {}

// 7. Console errors.
const real = consoleErrors.filter((e) => !/Download the React DevTools/.test(e));
rec("no console/page errors", real.length === 0, real.length ? real.join(" | ") : "clean");

await browser.close();

// 8. No-provider scenario: patch the mock to all-disconnected, then remount the
// Chat view (navigate away + back) so useModels re-fetches the patched catalog.
// Expect: no empty state, banner Step 1 ("Welcome to Sophos" / "Set up providers").
const nb = await chromium.launch({
  channel: "chrome", headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
});
const np = await nb.newPage({ viewport: { width: 1440, height: 900 } });
await np.goto(URL, { waitUntil: "networkidle", timeout: 30000 });
await np.evaluate(() => localStorage.clear());
await np.evaluate(async () => {
  const ipc = window.__sophosIpc;
  if (ipc) {
    if (!ipc.__orig) ipc.__orig = {};
    if (!ipc.__orig.getProviders) ipc.__orig.getProviders = ipc.getProviders.bind(ipc);
    ipc.getProviders = async () => (await ipc.__orig.getProviders()).map((p) => ({ ...p, connected: false }));
  }
});
// Remount the Chat view so useModels fetches the patched catalog.
await np.locator('nav button:has-text("Sessions")').click();
await np.waitForTimeout(500);
await np.locator('nav button:has-text("Chat")').click();
await np.waitForSelector("text=Conversation", { timeout: 30000 });
await np.waitForTimeout(1500);
const noProvEmpty = await np.locator("text=Start a conversation").count();
const noProvWelcome = await np.locator("text=Welcome to Sophos").count();
const noProvSetup = await np.locator('button:has-text("Set up providers")').count();
rec("no-provider: empty state hidden", noProvEmpty === 0, `'Start a conversation'=${noProvEmpty}`);
rec("no-provider: banner Step 1 shown", noProvWelcome > 0 && noProvSetup > 0, `'Welcome to Sophos'=${noProvWelcome}, Set up providers=${noProvSetup}`);
await nb.close();

const failed = results.filter((r) => !r.ok).length;
console.log(`\nVERDICT: ${failed === 0 ? "PASS" : "FAIL"} (${results.length - failed}/${results.length})`);
process.exit(failed === 0 ? 0 : 1);
