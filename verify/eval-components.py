"""Final check: how many components actually use the CSS variables vs hardcoded colors.

We sweep the rendered DOM and compare actual computed colors against the expected
light-theme values. The light theme should make ALL surfaces light, but the CSS
variables are only applied to :root, not the .sophos-shell or component CSS rules.
"""
import json
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

OUT = Path("C:/Users/Cayleb/.traycer/worktrees/cayleb-james2008__sophos/gauntlet-theme/verify/evaluator-screens")
URL = "http://localhost:1420/"

def main():
    findings = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()
        page.goto(URL)
        page.wait_for_load_state("networkidle")
        time.sleep(0.5)

        # Apply light theme
        page.evaluate("""
        () => {
            document.documentElement.setAttribute('data-theme', 'light');
            localStorage.setItem('prime-agent.settings.v1', JSON.stringify({ theme: 'light' }));
        }
        """)
        time.sleep(0.3)

        # Comprehensive sweep: every visible element with a background or color
        report = page.evaluate("""
        () => {
            const DARK_COLORS = new Set([
                'rgb(14, 14, 14)',     // #0e0e0e
                'rgb(21, 21, 21)',     // #151515
                'rgb(17, 17, 17)',     // #111
                'rgb(26, 26, 26)',     // #1a1a1a
                'rgb(42, 42, 42)',     // #2a2a2a
                'rgb(44, 44, 44)',     // #2c2c2c
            ]);
            const LIGHT_COLORS = new Set([
                'rgb(244, 244, 244)',  // #f4f4f4
                'rgb(255, 255, 255)',  // #ffffff
                'rgb(232, 232, 232)',  // #e8e8e8
                'rgb(240, 240, 240)',  // #f0f0f0
            ]);

            const darkSurfaces = [];
            const lightSurfaces = [];
            const darkText = [];
            const lightText = [];
            const stats = { total: 0, darkBg: 0, lightBg: 0, transparentBg: 0, darkText: 0, lightText: 0 };

            for (const el of document.querySelectorAll('body, body *')) {
                const cs = getComputedStyle(el);
                const rect = el.getBoundingClientRect();
                if (rect.width === 0 || rect.height === 0) continue;
                stats.total++;

                // Check background
                const bg = cs.backgroundColor;
                if (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') {
                    stats.transparentBg++;
                } else if (DARK_COLORS.has(bg)) {
                    stats.darkBg++;
                    if (darkSurfaces.length < 5) {
                        darkSurfaces.push({
                            tag: el.tagName,
                            class: el.className?.toString?.().slice(0, 60) || '',
                            bg,
                        });
                    }
                } else if (LIGHT_COLORS.has(bg)) {
                    stats.lightBg++;
                    if (lightSurfaces.length < 5) {
                        lightSurfaces.push({
                            tag: el.tagName,
                            class: el.className?.toString?.().slice(0, 60) || '',
                            bg,
                        });
                    }
                }

                // Check text color
                const color = cs.color;
                if (DARK_COLORS.has(color)) {
                    stats.darkText++;
                    if (darkText.length < 5) {
                        darkText.push({
                            tag: el.tagName,
                            class: el.className?.toString?.().slice(0, 60) || '',
                            color,
                        });
                    }
                } else if (LIGHT_COLORS.has(color)) {
                    stats.lightText++;
                    if (lightText.length < 5) {
                        lightText.push({
                            tag: el.tagName,
                            class: el.className?.toString?.().slice(0, 60) || '',
                            color,
                        });
                    }
                }
            }
            return { stats, darkSurfaces, lightSurfaces, darkText, lightText };
        }
        """)
        findings["sweep"] = report

        browser.close()

    print(json.dumps(findings, indent=2, default=str))

if __name__ == "__main__":
    main()
