"""Verify the light theme across all main views to confirm scope of the bug."""
import json
import sys
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

OUT = Path("C:/Users/Cayleb/.traycer/worktrees/cayleb-james2008__sophos/gauntlet-theme/verify/evaluator-screens")
URL = "http://localhost:1420/"

def main():
    findings = {"console_errors": [], "views": []}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()
        page.on("console", lambda msg: findings["console_errors"].append(f"{msg.type}: {msg.text}") if msg.type == "error" else None)
        page.on("pageerror", lambda err: findings["console_errors"].append(f"pageerror: {err}"))

        page.goto(URL)
        page.wait_for_load_state("networkidle")
        time.sleep(0.5)

        # Apply light theme and inspect each nav target
        page.evaluate("""
        () => {
            // Set theme to light
            document.documentElement.setAttribute('data-theme', 'light');
            localStorage.setItem('prime-agent.settings.v1', JSON.stringify({ theme: 'light' }));
        }
        """)
        time.sleep(0.3)

        # Inspect the sidebar, top bar, and main area for each view
        views = ["chat", "sessions", "agents", "inbox", "settings"]
        for view in views:
            try:
                # Click the nav link
                nav = page.locator(f'button:has-text("{view.capitalize()}"), [data-nav="{view}"]').first
                if nav.count() > 0:
                    nav.click()
                else:
                    # Use keyboard shortcut
                    shortcuts = {"chat": "1", "sessions": "2", "agents": "3", "inbox": "4", "settings": ","}
                    page.keyboard.press(f"Control+{shortcuts.get(view, '1')}")
                time.sleep(0.6)
            except Exception as e:
                findings["views"].append({"view": view, "error": str(e)})
                continue

            # Inspect the computed colors of the body and main UI elements
            colors = page.evaluate("""
            () => {
                const get = (sel) => {
                    const el = document.querySelector(sel);
                    if (!el) return null;
                    const cs = getComputedStyle(el);
                    return {
                        backgroundColor: cs.backgroundColor,
                        color: cs.color,
                        borderColor: cs.borderColor,
                    };
                };
                return {
                    body: get('body'),
                    sidebar: get('.shell-sidebar, aside, [class*="sidebar"]'),
                    topBar: get('.shell-topbar, header, [class*="topbar"]'),
                    main: get('main, [class*="main"]'),
                    card: get('.card, [class*="card"]'),
                    navItem: get('.shell-nav-item, nav button'),
                };
            }
            """)
            findings["views"].append({"view": view, "colors": colors})
            page.screenshot(path=str(OUT / f"light-{view}.png"), full_page=False)

        # Also check dark theme for comparison
        page.evaluate("""
        () => {
            document.documentElement.setAttribute('data-theme', 'dark');
            localStorage.setItem('prime-agent.settings.v1', JSON.stringify({ theme: 'dark' }));
        }
        """)
        time.sleep(0.3)
        for view in views:
            try:
                nav = page.locator(f'button:has-text("{view.capitalize()}"), [data-nav="{view}"]').first
                if nav.count() > 0:
                    nav.click()
                else:
                    shortcuts = {"chat": "1", "sessions": "2", "agents": "3", "inbox": "4", "settings": ","}
                    page.keyboard.press(f"Control+{shortcuts.get(view, '1')}")
                time.sleep(0.6)
            except Exception:
                continue
            page.screenshot(path=str(OUT / f"dark-{view}.png"), full_page=False)

        browser.close()

    print(json.dumps(findings, indent=2, default=str))

if __name__ == "__main__":
    main()
