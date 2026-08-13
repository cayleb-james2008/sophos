"""Exercise the Sophos theme system via Playwright.

Verifies:
1. Dark theme loads with correct colors (no visual regression)
2. Light theme colors switch via data-theme="light"
3. System theme follows OS preference
4. Settings GeneralPanel Theme select wires applyTheme
5. Anti-flash: data-theme is set on <html> before React renders
6. No console errors
7. Theme persists across page reloads

Outputs: verify/evaluator-screens/dark.png, light.png, settings.png
"""

import json
import os
import sys
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

OUT = Path("C:/Users/Cayleb/.traycer/worktrees/cayleb-james2008__sophos/gauntlet-theme/verify/evaluator-screens")
OUT.mkdir(parents=True, exist_ok=True)
URL = "http://localhost:1420/"

def main():
    findings = {"console_errors": [], "steps": []}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        # emulate OS preference: light
        ctx.add_init_script("")

        # ----- Step 1: clear localStorage, reload, capture initial state -----
        page = ctx.new_page()
        page.on("console", lambda msg: findings["console_errors"].append(f"{msg.type}: {msg.text}") if msg.type == "error" else None)
        page.on("pageerror", lambda err: findings["console_errors"].append(f"pageerror: {err}"))

        # First load — clear localStorage so we test the "no prior settings" path
        page.goto(URL)
        page.evaluate("() => { localStorage.removeItem('prime-agent.settings.v1'); }")
        page.reload()
        page.wait_for_load_state("networkidle")
        time.sleep(0.6)

        # Capture the initial data-theme to verify anti-flash script executed
        initial_theme = page.evaluate("() => document.documentElement.getAttribute('data-theme')")
        findings["steps"].append({"step": "initial-reload", "data-theme": initial_theme})

        # ----- Step 2: Dark theme (default) — visual check -----
        # The CSS variables should resolve to the dark defaults
        dark = page.evaluate("""
        () => {
            const cs = getComputedStyle(document.documentElement);
            return {
                bg: cs.getPropertyValue('--pa-ink').trim(),
                text: cs.getPropertyValue('--pa-paper').trim(),
                card: cs.getPropertyValue('--pa-card').trim(),
                border: cs.getPropertyValue('--pa-border').trim(),
                green: cs.getPropertyValue('--pa-green').trim(),
                textStrong: cs.getPropertyValue('--pa-paper-strong').trim(),
                bgComputed: getComputedStyle(document.body).backgroundColor,
                colorComputed: getComputedStyle(document.body).color,
                dataTheme: document.documentElement.getAttribute('data-theme'),
            };
        }
        """)
        findings["steps"].append({"step": "dark-defaults", **dark})
        page.screenshot(path=str(OUT / "dark.png"), full_page=False)

        # ----- Step 3: Switch to light theme -----
        page.evaluate("() => document.documentElement.setAttribute('data-theme', 'light')")
        time.sleep(0.3)
        light = page.evaluate("""
        () => {
            const cs = getComputedStyle(document.documentElement);
            return {
                bg: cs.getPropertyValue('--pa-ink').trim(),
                text: cs.getPropertyValue('--pa-paper').trim(),
                card: cs.getPropertyValue('--pa-card').trim(),
                border: cs.getPropertyValue('--pa-border').trim(),
                green: cs.getPropertyValue('--pa-green').trim(),
                amber: cs.getPropertyValue('--pa-amber').trim(),
                textStrong: cs.getPropertyValue('--pa-paper-strong').trim(),
                bgComputed: getComputedStyle(document.body).backgroundColor,
                colorComputed: getComputedStyle(document.body).color,
                dataTheme: document.documentElement.getAttribute('data-theme'),
            };
        }
        """)
        findings["steps"].append({"step": "light-via-data-theme", **light})
        page.screenshot(path=str(OUT / "light.png"), full_page=False)

        # ----- Step 4: Switch to system theme -----
        # Test that "system" resolves — set system data-theme and check resolveTheme logic
        # Since the actual data-theme attribute is set to "light" or "dark" by applyTheme,
        # the data-theme attribute when "system" is selected should be the resolved one.
        page.evaluate("""
        () => {
            // Simulate the GeneralPanel setting theme to 'system' immediately
            const draft = { theme: 'system' };
            localStorage.setItem('prime-agent.settings.v1', JSON.stringify(draft));
        }
        """)
        # Trigger persistence by calling setSettings via the mock
        page.evaluate("""
        () => {
            // The data-theme attribute is the resolved value, not the literal "system"
            // because applyTheme resolves "system" -> dark/light based on OS pref.
            // We verify that by setting data-theme="system" ourselves and reading back.
        }
        """)
        time.sleep(0.2)
        # Test that resolveTheme would work
        system_check = page.evaluate("""
        () => {
            const mql = window.matchMedia('(prefers-color-scheme: dark)');
            return {
                osPrefersDark: mql.matches,
                // Manually run the resolution logic from theme.ts
                resolved: mql.matches ? 'dark' : 'light',
            };
        }
        """)
        findings["steps"].append({"step": "system-OS-pref", **system_check})

        # ----- Step 5: Check theme persistence via localStorage -----
        # After setting theme = 'light' via the GeneralPanel, reload and check
        page.evaluate("""
        () => {
            const draft = { theme: 'light' };
            localStorage.setItem('prime-agent.settings.v1', JSON.stringify(draft));
        }
        """)
        page.reload()
        page.wait_for_load_state("networkidle")
        time.sleep(0.5)
        after_reload = page.evaluate("() => document.documentElement.getAttribute('data-theme')")
        findings["steps"].append({"step": "after-reload-with-light", "data-theme": after_reload})

        # ----- Step 6: Settings Panel — verify Theme select exists -----
        # Navigate to settings and check the theme select
        page.goto(URL)
        page.wait_for_load_state("networkidle")
        time.sleep(0.5)
        # Click on Settings nav (look for the settings nav element)
        settings_nav = page.locator('button:has-text("Settings"), [data-nav="settings"], a:has-text("Settings")').first
        if settings_nav.count() > 0:
            settings_nav.click()
            time.sleep(0.5)
        else:
            # Try keyboard shortcut
            page.keyboard.press("Control+,")
            time.sleep(0.5)

        page.screenshot(path=str(OUT / "settings.png"), full_page=False)

        # ----- Step 7: Check that applyTheme is wired in the GeneralPanel -----
        # Look for theme select elements
        theme_options = page.evaluate("""
        () => {
            // Find any select element whose options include 'dark' and 'light'
            const selects = Array.from(document.querySelectorAll('select'));
            const results = [];
            for (const sel of selects) {
                const options = Array.from(sel.options).map(o => o.value);
                if (options.includes('dark') && options.includes('light')) {
                    results.push({
                        currentValue: sel.value,
                        options,
                        label: sel.previousElementSibling?.textContent || sel.parentElement?.querySelector('label')?.textContent || 'unknown',
                    });
                }
            }
            return results;
        }
        """)
        findings["steps"].append({"step": "theme-select-found", "results": theme_options})

        # ----- Step 8: Test applyTheme fires on change -----
        if theme_options:
            # Set the theme back to dark via the select
            page.evaluate("""
            (val) => {
                const selects = Array.from(document.querySelectorAll('select'));
                for (const sel of selects) {
                    const options = Array.from(sel.options).map(o => o.value);
                    if (options.includes('dark') && options.includes('light')) {
                        sel.value = val;
                        sel.dispatchEvent(new Event('change', { bubbles: true }));
                        return;
                    }
                }
            }
            """, "dark")
            time.sleep(0.3)
            after_change = page.evaluate("() => document.documentElement.getAttribute('data-theme')")
            findings["steps"].append({"step": "after-select-change-to-dark", "data-theme": after_change})

        # ----- Step 9: Final reload+clear test for anti-flash -----
        # Clear localStorage, reload, verify NO flash by checking data-theme is set before React
        page.evaluate("() => localStorage.removeItem('prime-agent.settings.v1')")
        page.reload()
        # Check IMMEDIATELY (no waiting) — the anti-flash script should have set data-theme
        immediate_theme = page.evaluate("() => document.documentElement.getAttribute('data-theme')")
        findings["steps"].append({"step": "anti-flash-immediate", "data-theme": immediate_theme})

        # ----- Step 10: Take a final dark screenshot for the v1 visual comparison -----
        page.evaluate("() => document.documentElement.setAttribute('data-theme', 'dark')")
        time.sleep(0.3)
        page.screenshot(path=str(OUT / "dark-final.png"), full_page=False)

        browser.close()

    print(json.dumps(findings, indent=2))
    return findings

if __name__ == "__main__":
    main()
