"""Get past the first-run wizard and inspect the actual chat composer in light mode."""
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path("C:/Users/Cayleb/.traycer/worktrees/cayleb-james2008__sophos/gauntlet-theme")
OUT = ROOT / "verify/evaluator-screens/round2"
URL = "http://localhost:1420/"

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()

    # Set light theme and dismiss onboarding
    page.goto(URL)
    page.evaluate("""
    () => {
        localStorage.setItem('prime-agent.settings.v1', JSON.stringify({
            theme: 'light',
            shellPath: '',
            sessionDir: '',
            defaultProvider: 'ollama-cloud',
            defaultModel: 'deepseek-v4-flash:0731-cloud',
        }));
        localStorage.setItem('sophos.onboardingDismissed.v1', '1');
        document.documentElement.setAttribute('data-theme', 'light');
    }
    """)
    page.reload()
    page.wait_for_load_state("networkidle")
    time.sleep(1.5)

    # Take a screenshot of the chat view
    page.screenshot(path=str(OUT / "light-chat-dismissed.png"))
    print("Saved light-chat-dismissed.png")

    # Inspect the composer area
    composer = page.evaluate("""
    () => {
        const el = document.querySelector('.composer-input');
        if (!el) return null;
        const cs = getComputedStyle(el);
        return {
            tag: el.tagName,
            cls: el.className,
            bg: cs.backgroundColor,
            color: cs.color,
        };
    }
    """)
    print("Composer-input:", composer)

    # Type some text
    ta = page.locator('textarea').first
    if ta.count() > 0:
        ta.fill("Hello from the evaluator")
        time.sleep(0.3)
        page.screenshot(path=str(OUT / "light-chat-with-text.png"))
        print("Saved light-chat-with-text.png")

    browser.close()
