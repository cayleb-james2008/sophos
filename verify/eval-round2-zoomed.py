"""Round 2 deep-inspection script — focus on hardcoded rgba scrims/tints.

Specifically inspect:
1. System bar readout strip (rgba(0,0,0,0.16))
2. Inbox empty state scrim (rgba(14,14,14,0.35))
3. Command palette backdrop (rgba(14,14,14,0.72))
4. Graph/agents/sessions empty states (rgba(14,14,14,0.35/0.4))
5. Onboarding aside (rgba(0,0,0,0.12))

Take zoomed screenshots and report each.
"""
import json
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path("C:/Users/Cayleb/.traycer/worktrees/cayleb-james2008__sophos/gauntlet-theme")
OUT = ROOT / "verify/evaluator-screens/round2"
URL = "http://localhost:1420/"


def main():
    findings = {"checks": []}

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()

        # Set light theme
        page.goto(URL)
        page.evaluate("""
        () => {
            localStorage.setItem('prime-agent.settings.v1', JSON.stringify({ theme: 'light' }));
            document.documentElement.setAttribute('data-theme', 'light');
        }
        """)
        page.reload()
        page.wait_for_load_state("networkidle")
        time.sleep(0.7)

        # 1. System bar readout strip
        readout = page.evaluate("""
        () => {
            const el = document.querySelector('.system-bar__readout');
            if (!el) return null;
            const cs = getComputedStyle(el);
            return {
                bg: cs.backgroundColor,
                bgImage: cs.backgroundImage,
            };
        }
        """)
        findings["checks"].append({
            "name": "system-bar__readout (light mode)",
            "selector": ".system-bar__readout",
            "computed": readout,
            "expected_light_bg": "should be light (no rgba(0,0,0))",
        })

        # 2. Inbox empty state scrim (visit inbox)
        page.evaluate("""
        () => {
            const btns = document.querySelectorAll('button');
            for (const b of btns) {
                if (b.textContent && b.textContent.trim().toLowerCase().includes('inbox')) {
                    b.click();
                    return;
                }
            }
        }
        """)
        time.sleep(0.7)
        inbox_scrim = page.evaluate("""
        () => {
            const el = document.querySelector('.inbox__graphblank');
            if (!el) return null;
            const cs = getComputedStyle(el);
            return {
                bg: cs.backgroundColor,
                bgImage: cs.backgroundImage,
            };
        }
        """)
        findings["checks"].append({
            "name": "inbox__graphblank empty-state scrim (light mode)",
            "selector": ".inbox__graphblank",
            "computed": inbox_scrim,
            "expected_light_bg": "should not be rgba(14,14,14,X) — should invert or use --pa-ink with alpha",
        })
        page.screenshot(path=str(OUT / "light-inbox-zoom.png"), full_page=False)

        # 3. Command palette backdrop (open it via Cmd+K)
        page.evaluate("""
        () => {
            const btns = document.querySelectorAll('button');
            for (const b of btns) {
                if (b.textContent && b.textContent.trim().toLowerCase().includes('chat')) {
                    b.click();
                    return;
                }
            }
        }
        """)
        time.sleep(0.5)
        page.keyboard.press("Control+k")
        time.sleep(0.5)
        palette_backdrop = page.evaluate("""
        () => {
            const el = document.querySelector('.palette__backdrop');
            if (!el) return null;
            const cs = getComputedStyle(el);
            return {
                bg: cs.backgroundColor,
            };
        }
        """)
        findings["checks"].append({
            "name": "palette__backdrop (light mode)",
            "selector": ".palette__backdrop",
            "computed": palette_backdrop,
            "expected_light_bg": "scrim can stay dark for backdrop, BUT should still darken the visible canvas",
        })
        page.screenshot(path=str(OUT / "light-palette.png"), full_page=False)
        # Close palette
        page.keyboard.press("Escape")
        time.sleep(0.3)

        # 4. Agents empty state (navigate to agents and inspect)
        page.evaluate("""
        () => {
            const btns = document.querySelectorAll('button');
            for (const b of btns) {
                if (b.textContent && b.textContent.trim().toLowerCase().includes('agents')) {
                    b.click();
                    return;
                }
            }
        }
        """)
        time.sleep(0.7)
        ag_blank = page.evaluate("""
        () => {
            const el = document.querySelector('.ag-graphblank');
            if (!el) return null;
            const cs = getComputedStyle(el);
            return {
                bg: cs.backgroundColor,
            };
        }
        """)
        findings["checks"].append({
            "name": "agents__graphblank (light mode)",
            "selector": ".ag-graphblank",
            "computed": ag_blank,
            "expected_light_bg": "should not be rgba(14,14,14,0.35) — should match theme",
        })
        page.screenshot(path=str(OUT / "light-agents-zoom.png"), full_page=False)

        # 5. Sessions view: navigate to sessions, look at graph background and reset layout
        page.evaluate("""
        () => {
            const btns = document.querySelectorAll('button');
            for (const b of btns) {
                if (b.textContent && b.textContent.trim().toLowerCase().includes('sessions')) {
                    b.click();
                    return;
                }
            }
        }
        """)
        time.sleep(0.7)
        sess_blank = page.evaluate("""
        () => {
            const el = document.querySelector('.sessions__graphblank, .pg-blank');
            if (!el) return null;
            const cs = getComputedStyle(el);
            return {
                bg: cs.backgroundColor,
                cls: el.className,
            };
        }
        """)
        findings["checks"].append({
            "name": "sessions__graphblank (light mode)",
            "selector": ".sessions__graphblank / .pg-blank",
            "computed": sess_blank,
            "expected_light_bg": "should not be rgba(14,14,14,0.35)",
        })

        # 6. Onboarding aside (force first-run state by clearing localStorage settings)
        page.evaluate("""
        () => {
            localStorage.setItem('prime-agent.settings.v1', JSON.stringify({}));
        }
        """)
        # Reload to trigger first-run wizard
        # Note: depends on app state, may not show unless first-run flag set
        # Take screenshot anyway
        time.sleep(0.5)
        onboarding_aside = page.evaluate("""
        () => {
            const el = document.querySelector('.pa-onboarding__aside');
            if (!el) return null;
            const cs = getComputedStyle(el);
            return {
                bg: cs.backgroundColor,
            };
        }
        """)
        findings["checks"].append({
            "name": "onboarding__aside (light mode, if present)",
            "selector": ".pa-onboarding__aside",
            "computed": onboarding_aside,
            "expected_light_bg": "should not be rgba(0,0,0,0.12)",
        })

        # Take a zoomed screenshot of the topbar in light mode
        page.evaluate("""
        () => {
            const btns = document.querySelectorAll('button');
            for (const b of btns) {
                if (b.textContent && b.textContent.trim().toLowerCase().includes('chat')) {
                    b.click();
                    return;
                }
            }
        }
        """)
        time.sleep(0.5)
        page.screenshot(path=str(OUT / "light-topbar.png"), full_page=False, clip={"x": 0, "y": 0, "width": 1440, "height": 60})

        browser.close()

    out_json = OUT / "round2-deep-report.json"
    out_json.write_text(json.dumps(findings, indent=2, default=str))
    print(json.dumps(findings, indent=2, default=str))


if __name__ == "__main__":
    main()
