"""Round 2 evaluator — verify light theme works across the entire app.

Checks every bar item in detail:
1. Light theme works across all views (no dark surfaces, no light text on light)
2. Dark theme has zero visual regression (compare to reference)
3. System theme follows OS preference live
4. No flash of wrong theme on launch
5. Theme persists across restarts
6. GeneralPanel Select applies immediately
7. TypeScript + vitest pass (already checked separately)

Reports a structured JSON to stdout and screenshots to round2/ subdir.
"""
import json
import os
import sys
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path("C:/Users/Cayleb/.traycer/worktrees/cayleb-james2008__sophos/gauntlet-theme")
OUT = ROOT / "verify/evaluator-screens/round2"
OUT.mkdir(parents=True, exist_ok=True)
URL = "http://localhost:1420/"

# Reference: dark theme palette
DARK = {
    "bg": "rgb(14, 14, 14)",
    "text": "rgb(244, 244, 244)",
    "card": "rgb(21, 21, 21)",
    "border": "rgb(42, 42, 42)",
}
LIGHT = {
    "bg": "rgb(244, 244, 244)",
    "text": "rgb(14, 14, 14)",
    "card": "rgb(255, 255, 255)",
    "border": "rgba(0, 0, 0, 0.12)",
    "green": "rgb(63, 176, 80)",
}


def color_in(value: str, target: str, tol: int = 6) -> bool:
    """Compare two rgb(...) colors component-wise within tolerance."""
    import re
    p = re.compile(r"(\d+(?:\.\d+)?)")
    nums = p.findall(value)
    tnums = p.findall(target)
    if not nums or not tnums or len(nums) < 3 or len(tnums) < 3:
        return False
    try:
        for a, b in zip(nums[:3], tnums[:3]):
            if abs(float(a) - float(b)) > tol:
                return False
        return True
    except (ValueError, TypeError):
        return False


def rgb_to_grayscale(rgb_str: str) -> float:
    """Return luminance-like 0-255 grayscale (higher = lighter)."""
    import re
    p = re.compile(r"(\d+(?:\.\d+)?)")
    nums = p.findall(rgb_str)
    if len(nums) >= 3:
        try:
            r, g, b = [float(x) for x in nums[:3]]
            return 0.299 * r + 0.587 * g + 0.114 * b
        except ValueError:
            pass
    return 128.0


def main():
    findings = {
        "round": 2,
        "piece": "Theme System",
        "bar_checks": {},
        "defects": [],
        "console_errors": [],
        "screenshots": [],
    }

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()
        page.on("console", lambda msg: (
            findings["console_errors"].append(f"{msg.type}: {msg.text}")
            if msg.type == "error" else None
        ))
        page.on("pageerror", lambda err: findings["console_errors"].append(f"pageerror: {err}"))

        # Seed settings: dark theme, no system follow (so first paint is deterministic)
        page.goto(URL)
        page.evaluate("() => { localStorage.setItem('prime-agent.settings.v1', JSON.stringify({ theme: 'dark' })); }")
        page.reload()
        page.wait_for_load_state("networkidle")
        time.sleep(0.7)

        # ============ BAR CHECK 1: DARK THEME BASELINE ============
        # Take a dark-theme screenshot of chat and verify exact colors
        findings["bar_checks"]["dark_baseline"] = {}

        dark_body = page.evaluate("() => getComputedStyle(document.body).backgroundColor")
        dark_text = page.evaluate("() => getComputedStyle(document.body).color")
        dark_data_theme = page.evaluate("() => document.documentElement.getAttribute('data-theme')")
        findings["bar_checks"]["dark_baseline"] = {
            "data_theme": dark_data_theme,
            "body_bg": dark_body,
            "body_text": dark_text,
            "matches_dark_bg": color_in(dark_body, DARK["bg"]),
            "matches_dark_text": color_in(dark_text, DARK["text"]),
        }
        page.screenshot(path=str(OUT / "dark-chat.png"))
        findings["screenshots"].append("round2/dark-chat.png")

        # ============ BAR CHECK 2: LIGHT THEME ACROSS ALL VIEWS ============
        findings["bar_checks"]["light_theme_per_view"] = {}

        # Apply light theme via the same path the user uses
        page.evaluate("""
        () => {
            localStorage.setItem('prime-agent.settings.v1', JSON.stringify({ theme: 'light' }));
            document.documentElement.setAttribute('data-theme', 'light');
        }
        """)
        time.sleep(0.5)

        views_to_check = ["chat", "sessions", "agents", "inbox", "settings"]
        for view in views_to_check:
            try:
                page.evaluate(f"""
                () => {{
                    const btns = document.querySelectorAll('button');
                    for (const b of btns) {{
                        if (b.textContent && b.textContent.trim().toLowerCase().includes('{view}')) {{
                            b.click();
                            return;
                        }}
                    }}
                }}
                """)
            except Exception:
                pass
            time.sleep(0.7)

            colors = page.evaluate("""
            () => {
                const grab = (sel) => {
                    const el = document.querySelector(sel);
                    if (!el) return null;
                    const cs = getComputedStyle(el);
                    return {
                        bg: cs.backgroundColor,
                        color: cs.color,
                        border: cs.borderColor,
                    };
                };
                // Compute the deepest text-color in viewport
                const all = document.querySelectorAll('*');
                let lightTextCount = 0;
                let darkTextCount = 0;
                let darkBgCount = 0;
                let lightBgCount = 0;
                let total = 0;
                const isLightColor = (s) => {
                    if (!s || s === 'rgba(0, 0, 0, 0)' || s === 'transparent') return null;
                    const m = s.match(/rgba?\\((\\d+)/);
                    if (!m) return null;
                    return parseInt(m[1]) > 180;
                };
                const isDarkColor = (s) => {
                    if (!s || s === 'rgba(0, 0, 0, 0)' || s === 'transparent') return null;
                    const m = s.match(/rgba?\\((\\d+)/);
                    if (!m) return null;
                    return parseInt(m[1]) < 70;
                };
                for (const el of all) {
                    const cs = getComputedStyle(el);
                    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
                    const txt = isLightColor(cs.color);
                    if (txt === true) lightTextCount++;
                    if (txt === false) darkTextCount++;
                    const bg = isDarkColor(cs.backgroundColor);
                    if (bg === true) darkBgCount++;
                    if (bg === false) lightBgCount++;
                    total++;
                }
                return {
                    body: grab('body'),
                    sidebar: grab('.sidebar'),
                    sidebar_fallback: grab('aside'),
                    topbar: grab('.system-bar'),
                    main: grab('.shell__main'),
                    main_fallback: grab('main'),
                    stats: { lightTextCount, darkTextCount, darkBgCount, lightBgCount, total },
                };
            }
            """)
            findings["bar_checks"]["light_theme_per_view"][view] = colors
            page.screenshot(path=str(OUT / f"light-{view}.png"))
            findings["screenshots"].append(f"round2/light-{view}.png")

        # ============ BAR CHECK 3: NO LIGHT TEXT ON LIGHT BG ============
        # After visiting all views in light mode, count light text in the final DOM
        light_text_in_light = page.evaluate("""
        () => {
            const all = document.querySelectorAll('*');
            let count = 0;
            const samples = [];
            for (const el of all) {
                const cs = getComputedStyle(el);
                if (cs.display === 'none' || cs.visibility === 'hidden') continue;
                const m = cs.color.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);
                if (!m) continue;
                const r = parseInt(m[1]);
                // Light text: text color near white (>=200) AND not transparent
                if (r >= 200 && cs.color !== 'rgba(0, 0, 0, 0)') {
                    count++;
                    if (samples.length < 10) {
                        samples.push({
                            tag: el.tagName,
                            cls: el.className?.toString().slice(0, 80),
                            color: cs.color,
                            bg: cs.backgroundColor,
                            text: (el.textContent || '').slice(0, 30),
                        });
                    }
                }
            }
            return { count, samples };
        }
        """)
        findings["bar_checks"]["light_text_in_light_mode"] = light_text_in_light

        # ============ BAR CHECK 4: NO DARK BACKGROUNDS IN LIGHT MODE ============
        dark_bg_in_light = page.evaluate("""
        () => {
            const all = document.querySelectorAll('*');
            let count = 0;
            const samples = [];
            for (const el of all) {
                const cs = getComputedStyle(el);
                if (cs.display === 'none' || cs.visibility === 'hidden') continue;
                if (!cs.backgroundColor || cs.backgroundColor === 'rgba(0, 0, 0, 0)' || cs.backgroundColor === 'transparent') continue;
                const m = cs.backgroundColor.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);
                if (!m) continue;
                const r = parseInt(m[1]);
                const aMatch = cs.backgroundColor.match(/rgba\\(\\d+,\\s*\\d+,\\s*\\d+,\\s*([\\d.]+)\\)/);
                const alpha = aMatch ? parseFloat(aMatch[1]) : 1;
                // Dark background: bg color near black (r<40) AND alpha > 0.5 (visible)
                if (r < 40 && alpha > 0.5) {
                    count++;
                    if (samples.length < 10) {
                        samples.push({
                            tag: el.tagName,
                            cls: el.className?.toString().slice(0, 80),
                            bg: cs.backgroundColor,
                            text: (el.textContent || '').slice(0, 30),
                        });
                    }
                }
            }
            return { count, samples };
        }
        """)
        findings["bar_checks"]["dark_bg_in_light_mode"] = dark_bg_in_light

        # ============ BAR CHECK 5: BODY/APP BG + GREEN ACCENT ============
        body_bg_light = page.evaluate("() => getComputedStyle(document.body).backgroundColor")
        body_text_light = page.evaluate("() => getComputedStyle(document.body).color")
        findings["bar_checks"]["light_body"] = {
            "bg": body_bg_light,
            "text": body_text_light,
            "matches_light_bg": color_in(body_bg_light, LIGHT["bg"]),
            "matches_light_text": color_in(body_text_light, LIGHT["text"]),
        }

        # Look for the green accent (a known green text/border)
        green_present = page.evaluate("""
        () => {
            // Look for any element with green color
            const all = document.querySelectorAll('*');
            let count = 0;
            const samples = [];
            for (const el of all) {
                const cs = getComputedStyle(el);
                if (cs.display === 'none') continue;
                const m = cs.color.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);
                if (!m) continue;
                const r = parseInt(m[1]);
                const g = parseInt(m[2]);
                const b = parseInt(m[3]);
                // Green: green channel dominates
                if (g > 130 && g > r * 1.4 && g > b * 1.4) {
                    count++;
                    if (samples.length < 3) samples.push({
                        tag: el.tagName,
                        cls: el.className?.toString().slice(0, 50),
                        color: cs.color,
                    });
                }
            }
            return { count, samples };
        }
        """)
        findings["bar_checks"]["green_accent_visible"] = green_present

        # ============ BAR CHECK 6: SYSTEM THEME FOLLOWS OS ============
        # Set theme to system, then emulate OS preference flips
        page.evaluate("""
        () => {
            localStorage.setItem('prime-agent.settings.v1', JSON.stringify({ theme: 'system' }));
        }
        """)
        # Test light OS preference
        page.emulate_media(color_scheme="light")
        page.reload()
        page.wait_for_load_state("networkidle")
        time.sleep(0.5)
        light_os_data_theme = page.evaluate("() => document.documentElement.getAttribute('data-theme')")

        # Test dark OS preference
        page.emulate_media(color_scheme="dark")
        page.reload()
        page.wait_for_load_state("networkidle")
        time.sleep(0.5)
        dark_os_data_theme = page.evaluate("() => document.documentElement.getAttribute('data-theme')")

        findings["bar_checks"]["system_theme"] = {
            "os_light_resolves_to": light_os_data_theme,
            "os_dark_resolves_to": dark_os_data_theme,
            "passes": light_os_data_theme == "light" and dark_os_data_theme == "dark",
        }

        # ============ BAR CHECK 7: ANTI-FLASH (LIGHT) ============
        # Set theme to light, navigate fresh, check data-theme before network idle
        page.emulate_media(color_scheme="dark")  # OS wants dark
        page.evaluate("""
        () => {
            localStorage.setItem('prime-agent.settings.v1', JSON.stringify({ theme: 'light' }));
        }
        """)
        # New page to inspect at DOMContentLoaded before CSS settles
        page2 = ctx.new_page()
        flash_check = page2.evaluate("""
        async () => {
            // Reload to test anti-flash script
            return new Promise((resolve) => {
                const observer = new MutationObserver((mutations) => {
                    for (const m of mutations) {
                        if (m.attributeName === 'data-theme') {
                            resolve({
                                firstDataTheme: document.documentElement.getAttribute('data-theme'),
                                readyState: document.readyState,
                            });
                            observer.disconnect();
                            return;
                        }
                    }
                });
                observer.observe(document.documentElement, { attributes: true });
                setTimeout(() => resolve({
                    firstDataTheme: document.documentElement.getAttribute('data-theme'),
                    readyState: document.readyState,
                    timeout: true,
                }), 1500);
            });
        }
        """)
        page2.goto(URL)
        flash_result = page2.evaluate("""
        async () => {
            return new Promise((resolve) => {
                const observer = new MutationObserver((mutations) => {
                    for (const m of mutations) {
                        if (m.attributeName === 'data-theme') {
                            resolve({
                                firstDataTheme: document.documentElement.getAttribute('data-theme'),
                                readyState: document.readyState,
                            });
                            observer.disconnect();
                            return;
                        }
                    }
                });
                observer.observe(document.documentElement, { attributes: true });
                setTimeout(() => resolve({
                    firstDataTheme: document.documentElement.getAttribute('data-theme'),
                    readyState: document.readyState,
                    timeout: true,
                }), 1500);
            });
        }
        """)
        page2.close()
        findings["bar_checks"]["anti_flash"] = {
            "firstDataTheme_after_navigate": flash_result,
            "expected": "light (because persisted)",
            "passes": flash_result.get("firstDataTheme") == "light",
        }

        # ============ BAR CHECK 8: GENERAL PANEL IMMEDIATE APPLY ============
        # Open settings, change theme to dark, verify it flips without save
        page.evaluate("""
        () => {
            localStorage.setItem('prime-agent.settings.v1', JSON.stringify({ theme: 'light' }));
            document.documentElement.setAttribute('data-theme', 'light');
        }
        """)
        page.reload()
        page.wait_for_load_state("networkidle")
        time.sleep(0.7)
        # Open settings
        page.keyboard.press("Control+,")
        time.sleep(0.5)
        # Look for theme select
        theme_select_result = page.evaluate("""
        () => {
            const sels = document.querySelectorAll('select');
            let themeSel = null;
            for (const s of sels) {
                const opts = Array.from(s.options).map(o => o.value);
                if (opts.includes('light') && opts.includes('dark') && opts.includes('system')) {
                    themeSel = s;
                    break;
                }
            }
            return {
                found: !!themeSel,
                value_before: themeSel ? themeSel.value : null,
                options: themeSel ? Array.from(themeSel.options).map(o => ({ value: o.value, text: o.text })) : null,
            };
        }
        """)
        # Change theme to dark
        page.evaluate("""
        () => {
            const sels = document.querySelectorAll('select');
            for (const s of sels) {
                const opts = Array.from(s.options).map(o => o.value);
                if (opts.includes('light') && opts.includes('dark') && opts.includes('system')) {
                    s.value = 'dark';
                    s.dispatchEvent(new Event('change', { bubbles: true }));
                    return true;
                }
            }
            return false;
        }
        """)
        time.sleep(0.4)
        after_apply = page.evaluate("() => document.documentElement.getAttribute('data-theme')")
        findings["bar_checks"]["general_panel_immediate_apply"] = {
            "select_found": theme_select_result,
            "after_change_data_theme": after_apply,
            "passes": after_apply == "dark",
        }

        # ============ BAR CHECK 9: PERSISTENCE ACROSS RESTARTS ============
        # Set light, close page, open new page, verify still light
        page.evaluate("""
        () => {
            localStorage.setItem('prime-agent.settings.v1', JSON.stringify({ theme: 'light' }));
            document.documentElement.setAttribute('data-theme', 'light');
        }
        """)
        page3 = ctx.new_page()
        page3.goto(URL)
        page3.wait_for_load_state("networkidle")
        time.sleep(0.5)
        persisted = page3.evaluate("() => document.documentElement.getAttribute('data-theme')")
        page3.close()
        findings["bar_checks"]["persistence"] = {
            "after_reload_data_theme": persisted,
            "expected": "light",
            "passes": persisted == "light",
        }

        browser.close()

    # Output structured findings
    out_json = ROOT / "verify/evaluator-screens/round2-report.json"
    out_json.write_text(json.dumps(findings, indent=2, default=str))
    print(json.dumps(findings, indent=2, default=str))


if __name__ == "__main__":
    main()
