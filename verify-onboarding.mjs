// Evaluate the onboarding wizard via Playwright
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const SHOTS = 'C:/Users/Cayleb/.traycer/worktrees/cayleb-james2008__sophos/gauntlet-onboarding/eval-shots';
fs.mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Users/Cayleb/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe',
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const consoleEvents = [];
page.on('console', (m) => consoleEvents.push({ type: m.type(), text: m.text() }));
page.on('pageerror', (e) => consoleEvents.push({ type: 'pageerror', text: e.message }));

const url = 'http://localhost:1420/';
console.log('GOTO', url);
await page.goto(url, { waitUntil: 'networkidle' });

// Wipe the dismiss/firstMessage flags to simulate first run.
await page.evaluate(() => {
  localStorage.removeItem('sophos.onboardingDismissed.v1');
  localStorage.removeItem('sophos.hasFirstMessage.v1');
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);

// Are we in preview / not tauri? Capture environment.
const env = await page.evaluate(() => ({
  hasOnboarding: !!document.querySelector('.pa-onboarding'),
  title: document.title,
  localStorageDump: { ...localStorage },
}));
console.log('ENV', JSON.stringify(env, null, 2));

// Screenshot 1: Welcome step
await page.screenshot({ path: `${SHOTS}/01-welcome.png`, fullPage: true });

// Click Get started to go to provider step
const getStarted = page.locator('button:has-text("Get started")');
if (await getStarted.count()) {
  await getStarted.first().click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/02-provider.png`, fullPage: true });
}

// Click Next (provider is auto-ready in preview)
const nextProvider = page.locator('button:has-text("Next")').first();
if (await nextProvider.count()) {
  await nextProvider.click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/03-model.png`, fullPage: true });
}

// Click Next on model step
const nextModel = page.locator('button:has-text("Next")').first();
if (await nextModel.count()) {
  await nextModel.click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/04-firstPrompt.png`, fullPage: true });
}

// Verify Skip button: dismiss from current step
const skipBtn = page.locator('button:has-text("Skip")').first();
const skipVisible = await skipBtn.isVisible().catch(() => false);
console.log('Skip visible on final step:', skipVisible);
if (skipVisible) {
  await skipBtn.click();
  await page.waitForTimeout(400);
  const wizardGone = await page.locator('.pa-onboarding').count();
  console.log('Wizard element count after skip:', wizardGone);
  const lsAfter = await page.evaluate(() => ({ ...localStorage }));
  console.log('localStorage after skip:', lsAfter);
}

// Now navigate to Settings → General and find Run onboarding again.
await page.keyboard.press('Control+,');
await page.waitForTimeout(500);
await page.screenshot({ path: `${SHOTS}/05-settings-general.png`, fullPage: true });

const runAgainBtn = page.locator('button:has-text("Run onboarding again")');
const runAgainCount = await runAgainBtn.count();
console.log('Run onboarding again button count:', runAgainCount);
if (runAgainCount > 0) {
  await runAgainBtn.first().click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/06-retriggered.png`, fullPage: true });
  const reappeared = await page.locator('.pa-onboarding').count();
  console.log('Wizard re-appeared after Run-again click:', reappeared);
}

// Now test the Esc-to-dismiss from step 1 (welcome)
const escStep1Visible = await page.locator('.pa-onboarding').count();
console.log('Esc test, wizard visible:', escStep1Visible);
if (escStep1Visible) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const afterEsc = await page.locator('.pa-onboarding').count();
  console.log('Wizard after Esc:', afterEsc);
}

// Now test "Re-run" cycle with fresh localStorage, then click Skip on welcome
await page.evaluate(() => {
  localStorage.removeItem('sophos.onboardingDismissed.v1');
  localStorage.removeItem('sophos.hasFirstMessage.v1');
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);
const welcomeVisible = await page.locator('.pa-onboarding').count();
console.log('After reload+wipe, wizard visible:', welcomeVisible);

// Click Skip from welcome
const welcomeSkip = page.locator('.pa-onboarding button:has-text("Skip")').first();
if (await welcomeSkip.count()) {
  await welcomeSkip.click();
  await page.waitForTimeout(300);
  const lsAfter2 = await page.evaluate(() => ({ ...localStorage }));
  console.log('localStorage after welcome skip:', lsAfter2);
}

// Console errors
console.log('\n=== Console events ===');
for (const ev of consoleEvents) {
  console.log(`[${ev.type}] ${ev.text}`);
}

await browser.close();
console.log('\nScreenshots in', SHOTS);