"""Verify the system theme follows OS preference and persists across restarts."""
import json
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

OUT = Path("C:/Users/Cayleb/.traycer/worktrees/cayleb-james2008__sophos/gauntlet-theme/verify/evaluator-screens")
URL = "http://localhost:1420/"

def main():
    findings = {"console_errors": [], "tests": []}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        # Test 1: OS prefers dark, system theme should resolve to dark
        ctx_dark = browser.new_context(viewport={"width": 1440, "height": 900}, color_scheme="dark")
        page = ctx_dark.new_page()
        page.on("console", lambda msg: findings["console_errors"].append(f"{msg.type}: {msg.text}") if msg.type == "error" else None)
        page.on("pageerror", lambda err: findings["console_errors"].append(f"pageerror: {err}"))

        page.goto(URL)
        page.evaluate("""
        () => {
            localStorage.setItem('prime-agent.settings.v1', JSON.stringify({ theme: 'system' }));
        }
        """)
        page.reload()
        page.wait_for_load_state("networkidle")
        time.sleep(0.5)
        system_dark = page.evaluate("""
        () => ({
            dataTheme: document.documentElement.getAttribute('data-theme'),
            osPrefersDark: window.matchMedia('(prefers-color-scheme: dark)').matches,
        })
        """)
        findings["tests"].append({"test": "system-on-dark-os", **system_dark})
        ctx_dark.close()

        # Test 2: OS prefers light, system theme should resolve to light
        ctx_light = browser.new_context(viewport={"width": 1440, "height": 900}, color_scheme="light")
        page = ctx_light.new_page()
        page.on("console", lambda msg: findings["console_errors"].append(f"{msg.type}: {msg.text}") if msg.type == "error" else None)
        page.on("pageerror", lambda err: findings["console_errors"].append(f"pageerror: {err}"))

        page.goto(URL)
        page.evaluate("""
        () => {
            localStorage.setItem('prime-agent.settings.v1', JSON.stringify({ theme: 'system' }));
        }
        """)
        page.reload()
        page.wait_for_load_state("networkidle")
        time.sleep(0.5)
        system_light = page.evaluate("""
        () => ({
            dataTheme: document.documentElement.getAttribute('data-theme'),
            osPrefersDark: window.matchMedia('(prefers-color-scheme: dark)').matches,
        })
        """)
        findings["tests"].append({"test": "system-on-light-os", **system_light})
        ctx_light.close()

        # Test 3: Persistence — set theme = light, reload, verify it stays light
        ctx_persist = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx_persist.new_page()
        page.on("console", lambda msg: findings["console_errors"].append(f"{msg.type}: {msg.text}") if msg.type == "error" else None)

        page.goto(URL)
        page.evaluate("""
        () => {
            localStorage.setItem('prime-agent.settings.v1', JSON.stringify({ theme: 'light' }));
        }
        """)
        # Reload several times to ensure persistence
        for i in range(3):
            page.reload()
            page.wait_for_load_state("networkidle")
            time.sleep(0.3)
            t = page.evaluate("() => document.documentElement.getAttribute('data-theme')")
            findings["tests"].append({"test": f"persist-light-reload-{i+1}", "data-theme": t})

        # Test 4: Anti-flash — verify inline script runs before React rendering
        # We need to intercept the very first script execution
        page.goto(URL)
        page.evaluate("() => localStorage.setItem('prime-agent.settings.v1', JSON.stringify({ theme: 'light' }))")
        # Use a low-level evaluation to check the data-theme was set BEFORE the JS module loads
        page.evaluate("""
        () => {
            // This won't really test timing, but we can verify the data-theme is set
            window.__beforeReact = document.documentElement.getAttribute('data-theme');
        }
        """)
        # Now reload and check IMMEDIATELY (no wait)
        page.goto(URL, wait_until="commit")
        # At this point only the inline script in <head> has run, not main.tsx
        immediate = page.evaluate("() => document.documentElement.getAttribute('data-theme')")
        findings["tests"].append({"test": "anti-flash-immediate", "data-theme": immediate})

        browser.close()

    print(json.dumps(findings, indent=2))

if __name__ == "__main__":
    main()
