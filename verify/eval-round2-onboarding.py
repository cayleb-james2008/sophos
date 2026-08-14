"""Check the first-run onboarding in light mode."""
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

    # Reset everything to show onboarding
    page.goto(URL)
    page.evaluate("""
    () => {
        localStorage.clear();
        localStorage.setItem('prime-agent.settings.v1', JSON.stringify({ theme: 'light' }));
        document.documentElement.setAttribute('data-theme', 'light');
    }
    """)
    page.reload()
    page.wait_for_load_state("networkidle")
    time.sleep(1.5)

    page.screenshot(path=str(OUT / "light-onboarding.png"))
    print("Saved light-onboarding.png")

    # Inspect onboarding aside
    ob = page.evaluate("""
    () => {
        const aside = document.querySelector('.pa-onboarding__aside');
        if (!aside) return null;
        const cs = getComputedStyle(aside);
        return {
            bg: cs.backgroundColor,
        };
    }
    """)
    print("Onboarding aside:", ob)

    # Inspect the primary button
    btn = page.evaluate("""
    () => {
        const b = document.querySelector('.pa-onboarding__primary, button[class*="primary"]');
        if (!b) return null;
        const cs = getComputedStyle(b);
        return {
            bg: cs.backgroundColor,
            color: cs.color,
        };
    }
    """)
    print("Primary button:", btn)

    browser.close()
