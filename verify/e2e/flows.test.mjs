// verify/e2e/flows.test.mjs — agentic flow coverage: send, steer, follow-up
// queue, abort, side questions, command palette, session actions, model
// selector, provider auth, export.
import { navTo, sendMessage, waitBusy, waitIdle } from "./helpers.mjs";
import { patchProviderLoginFlow, restoreMock } from "./mock-patch.mjs";

export const flows = [
  {
    section: "Flows",
    name: "Send a message → user msg + streaming assistant + completes",
    fn: async ({ page, shot, expect }) => {
      await navTo(page, "Chat");
      await sendMessage(page, "hello e2e");
      // User message appears.
      await expect(await page.locator("text=hello e2e").count() > 0, "user message not rendered");
      // Busy state appears.
      await waitBusy(page);
      await shot("flow-send-busy");
      // Streaming assistant message appears (answer streams in ~3s).
      await page.waitForSelector("text=Got it — you said", { timeout: 15000 });
      await expect(await page.locator("text=Got it — you said").count() > 0, "assistant reply not rendered");
      // Completes → idle.
      await waitIdle(page, 20000);
      await expect(await page.locator("text=ready").count() > 0, "composer not back to ready");
      await shot("flow-send-done");
      return true;
    },
  },
  {
    section: "Flows",
    name: "Steering (Enter while busy) shows steered indicator",
    fn: async ({ page, shot, expect }) => {
      await navTo(page, "Chat");
      await sendMessage(page, "start a long task");
      await waitBusy(page);
      // Type a steer and press Enter while busy.
      const ta = page.locator('textarea[aria-label="Message input"]');
      await ta.fill("steer: focus on tests");
      await ta.press("Enter");
      // Steered indicator is transient (4s) — catch it fast.
      await expect(await page.locator("text=steered").count() > 0, "steered indicator missing");
      await shot("flow-steer");
      await waitIdle(page, 20000);
      return true;
    },
  },
  {
    section: "Flows",
    name: "Follow-up queue (Alt+Enter) drains one at a time",
    fn: async ({ page, shot, expect }) => {
      await navTo(page, "Chat");
      await sendMessage(page, "queue test");
      await waitBusy(page);
      const ta = page.locator('textarea[aria-label="Message input"]');
      // Queue two follow-ups.
      await ta.fill("followup one");
      await ta.press("Alt+Enter");
      await ta.fill("followup two");
      await ta.press("Alt+Enter");
      // The "queued" footer hint only renders while followUps.length > 0.
      await expect(await page.locator("text=queued").count() > 0, "follow-up queue not shown");
      await shot("flow-followup-queued");
      // Wait for the queue to fully drain (each follow-up runs as its own turn).
      await page.waitForFunction(() => !document.body.innerText.includes("queued"), { timeout: 30000 });
      await shot("flow-followup-drained");
      // Both follow-ups should have become user messages.
      await expect(await page.locator("text=followup one").count() > 0, "follow-up 1 not delivered");
      await expect(await page.locator("text=followup two").count() > 0, "follow-up 2 not delivered");
      await waitIdle(page, 20000);
      return true;
    },
  },
  {
    section: "Flows",
    name: "Abort mid-stream (Stop button) clears busy",
    fn: async ({ page, shot, expect }) => {
      await navTo(page, "Chat");
      await sendMessage(page, "abort me");
      await waitBusy(page);
      await page.click('button[aria-label="Stop generating"]');
      await waitIdle(page, 5000);
      await expect(await page.locator("text=ready").count() > 0, "composer not idle after abort");
      await shot("flow-abort");
      return true;
    },
  },
  {
    section: "Flows",
    name: "Side question (/btw) opens inline panel and completes",
    fn: async ({ page, shot, expect }) => {
      await navTo(page, "Chat");
      await sendMessage(page, "/btw what is 2+2");
      await expect(await page.locator("text=/btw").count() > 0, "side question panel missing");
      await expect(await page.locator("text=what is 2+2").count() > 0, "side question text missing");
      // The reply is collapsed by default — expand it via the "Show reply" toggle.
      await page.click('button[aria-label="Show reply"]');
      await page.waitForSelector("text=Side reply (demo preview)", { timeout: 5000 });
      await shot("flow-sidequestion");
      return true;
    },
  },
  {
    section: "Flows",
    name: "Command palette (⌘K) opens, lists commands, closes",
    fn: async ({ page, shot, expect }) => {
      await navTo(page, "Chat");
      await page.keyboard.press("Control+k");
      await page.waitForSelector('input[placeholder="Type a command or search…"]', { timeout: 5000 });
      await expect(await page.locator("text=refine").count() > 0, "refine command missing");
      await expect(await page.locator("text=compact").count() > 0, "compact command missing");
      await expect(await page.locator("text=export").count() > 0, "export command missing");
      await shot("flow-palette");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      await expect(await page.locator('input[placeholder="Type a command or search…"]').count() === 0, "palette did not close");
      return true;
    },
  },
  {
    section: "Flows",
    name: "Model selector switches model",
    fn: async ({ page, shot, expect }) => {
      await navTo(page, "Chat");
      await page.click('button[aria-haspopup="listbox"]');
      await page.waitForSelector('div[role="listbox"]', { timeout: 5000 });
      await expect(await page.locator("text=MiniMax M3").count() > 0, "MiniMax model option missing");
      await page.click('button[role="option"]:has-text("MiniMax M3")');
      await page.waitForTimeout(600);
      // System bar model readout should now show MiniMax M3.
      await expect(await page.locator("text=MiniMax M3").count() > 0, "model did not switch in system bar");
      await shot("flow-model");
      return true;
    },
  },
  {
    section: "Flows",
    name: "Provider login flow (Connect → modal → submit → connected)",
    fn: async ({ page, shot, expect }) => {
      // Patch the mock so the first provider (Ollama Cloud) starts disconnected
      // and login reconnects it — the all-connected default can't reach this.
      await patchProviderLoginFlow(page);
      try {
        await navTo(page, "Chat");
        await navTo(page, "Settings");
        await page.click('button[role="tab"]:has-text("Providers")', { force: true });
        await page.waitForTimeout(600);
        // Disconnected provider shows a Connect button.
        const connect = page.locator('button:has-text("Connect")').first();
        await expect(await connect.count() > 0, "Connect button missing for disconnected provider");
        await connect.click();
        // Login modal opens.
        await page.waitForSelector("text=Connect Ollama Cloud", { timeout: 5000 });
        await expect(await page.locator('input[placeholder="sk-…"]').count() === 1, "API key input missing in login modal");
        await shot("flow-login-modal");
        // Enter an API key and submit via the modal's Connect button.
        await page.fill('input[placeholder="sk-…"]', "sk-test-key");
        await page.click('div[role="dialog"] button:has-text("Connect")');
        await page.waitForTimeout(800);
        // Modal closes and the provider is now connected (Log out button).
        await expect(await page.locator('input[placeholder="sk-…"]').count() === 0, "login modal did not close");
        await expect(await page.locator('button:has-text("Log out")').count() > 0, "provider not connected after login");
        await shot("flow-login-connected");
        return true;
      } finally {
        await restoreMock(page, ["getProviders", "login"]);
        // Close any stuck modal so later tests aren't blocked.
        await page.keyboard.press("Escape").catch(() => {});
        await page.waitForTimeout(200);
      }
    },
  },
  {
    section: "Flows",
    name: "Provider logout does not error",
    fn: async ({ page, shot, expect }) => {
      await navTo(page, "Settings");
      await page.click('button[role="tab"]:has-text("Providers")', { force: true });
      await page.waitForTimeout(500);
      const logout = page.locator('button:has-text("Log out")').first();
      await expect(await logout.count() > 0, "no Log out button (providers not connected)");
      await logout.click();
      await page.waitForTimeout(600);
      // Mock logout is a no-op; the card should still render without a page error.
      await expect(await page.locator("text=Ollama Cloud").count() > 0, "provider card broke after logout");
      await shot("flow-provider-logout");
      return true;
    },
  },
  {
    section: "Flows",
    name: "Export session shows toast",
    fn: async ({ page, shot, expect }) => {
      await navTo(page, "Chat");
      await page.click('button[aria-label="Export session to HTML"]');
      await page.waitForSelector("text=Exporting session to HTML…", { timeout: 5000 });
      await shot("flow-export");
      return true;
    },
  },
  {
    section: "Flows",
    name: "Session Resume / Fork actions from detail",
    fn: async ({ page, shot, expect }) => {
      await navTo(page, "Sessions");
      await page.locator("text=Refactor auth module").first().click();
      // Detail inspector loads async — wait for its actions to appear.
      await page.waitForSelector('button:has-text("Resume")', { timeout: 10000 });
      await page.click('button:has-text("Resume")');
      await page.waitForTimeout(500);
      // Resume switches the active session — the detail should still render context.
      await expect(await page.locator("text=Context usage").count() > 0, "detail broke after Resume");
      await page.click('button:has-text("Fork")');
      await page.waitForTimeout(500);
      // After Fork the view refreshes: session list + detail remain functional,
      // and no error banner appears.
      await expect(await page.locator("text=Refactor auth module").count() > 0, "session list lost after Fork");
      await expect(await page.locator("text=Context usage").count() > 0, "detail broke after Fork");
      await expect(await page.locator("text=Sessions unavailable").count() === 0, "error banner appeared after actions");
      await shot("flow-session-actions");
      return true;
    },
  },
  {
    section: "Flows",
    name: "New session modal opens from Chat header",
    fn: async ({ page, shot, expect }) => {
      await navTo(page, "Chat");
      await page.click('button:has-text("New session")');
      await page.waitForTimeout(400);
      await expect(await page.locator("text=New session").count() > 0, "new session modal missing");
      await shot("flow-new-session");
      // Close via Escape.
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      return true;
    },
  },
];
