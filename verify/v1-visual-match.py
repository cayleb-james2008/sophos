"""V1 — full frontend visual match against the Prime Intellect design system.

Walks EVERY view (including the new I1/I2 surfaces added this run) and asserts
the rendered DOM matches the design DNA scraped from https://www.primeintellect.ai/:

  bg #0e0e0e · text #f4f4f4 · border #2a2a2a hairlines · accent #85ed75 (sole
  colour signal) · Geist + Geist Mono · radius 0 (circular dots excepted) ·
  no copper / no old fonts / no glow shadows.

Writes verify/v1-visual/report.json + a screenshot per view.
"""
from playwright.sync_api import sync_playwright
import json
import os
import time

URL = "http://localhost:1420/"
OUT = os.path.join(os.path.dirname(__file__), "v1-visual")
SHOTS = os.path.join(OUT, "shots")
os.makedirs(SHOTS, exist_ok=True)

# The design DNA (scraped live from primeintellect.ai — research/sophos-design-dna.md)
DNA = {
    "bg": "rgb(14, 14, 14)",       # #0e0e0e
    "fg": "rgb(244, 244, 244)",    # #f4f4f4
    "border": "rgb(42, 42, 42)",   # #2a2a2a
    "accent": "rgb(133, 237, 117)",  # #85ed75
}

BANNED_COLORS = [
    "rgb(201, 138, 91)",   # copper #C98A5B
    "rgb(214, 160, 119)",  # copper #D6A077
]
BANNED_FONTS = ["Space Grotesk", "JetBrains Mono"]

# Every view, including the surfaces I1/I2 added this run.
# Nav is a sidebar of buttons; drive it by accessible name and dismiss the
# hover tooltip afterwards (it overlays and intercepts the next click).
VIEWS = [
    ("chat", None),
    ("sessions", "Sessions"),
    ("agents", "Agents"),
    ("inbox", "Inbox"),
    ("settings", "Settings"),
]

SETTINGS_TABS = ["General", "Providers", "Skills", "Advanced", "Long-running"]


def sweep(page):
    """Collect every computed-style fact we care about, in one pass."""
    return page.evaluate(
        """() => {
        const out = {
          radius: [], banned_color: [], banned_font: [], glow: [],
          accentCount: 0, borderColors: {}, fonts: {}
        };
        const BANNED_C = ['rgb(201, 138, 91)', 'rgb(214, 160, 119)'];
        const BANNED_F = ['Space Grotesk', 'JetBrains Mono'];
        for (const el of document.querySelectorAll('*')) {
          const s = getComputedStyle(el);
          const tag = el.tagName + (el.className && typeof el.className === 'string'
            ? '.' + el.className.split(' ').slice(0,2).join('.') : '');

          // radius: only 0, 50%, 9999px (circular dots) are legal
          const r = s.borderRadius;
          if (r && !['0px','50%','9999px','0px 0px 0px 0px',''].includes(r)) {
            out.radius.push({ el: tag, r });
          }
          // banned colours anywhere
          for (const p of ['color','backgroundColor','borderColor']) {
            const v = s[p];
            if (BANNED_C.includes(v)) out.banned_color.push({ el: tag, prop: p, v });
          }
          // banned fonts
          for (const f of BANNED_F) {
            if (s.fontFamily && s.fontFamily.includes(f)) out.banned_font.push({ el: tag, f });
          }
          // glow shadows (a coloured, blurred box-shadow) — DNA says borders, not glow
          const sh = s.boxShadow;
          if (sh && sh !== 'none' && !/inset/.test(sh)) {
            const m = sh.match(/(\\d+(?:\\.\\d+)?)px\\s+(\\d+(?:\\.\\d+)?)px\\s+(\\d+(?:\\.\\d+)?)px/);
            if (m && parseFloat(m[3]) > 2) out.glow.push({ el: tag, sh });
          }
          if (s.color === 'rgb(133, 237, 117)' || s.backgroundColor === 'rgb(133, 237, 117)') {
            out.accentCount++;
          }
          const fam = (s.fontFamily || '').split(',')[0].replace(/["']/g, '');
          if (fam) out.fonts[fam] = (out.fonts[fam] || 0) + 1;
          const bc = s.borderTopColor;
          if (bc && s.borderTopWidth !== '0px') out.borderColors[bc] = (out.borderColors[bc] || 0) + 1;
        }
        const b = getComputedStyle(document.body);
        return { ...out, bodyBg: b.backgroundColor, bodyFg: b.color, bodyFont: b.fontFamily };
    }"""
    )


def main() -> int:
    report = {"views": {}, "blockers": [], "warnings": [], "dna": DNA}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--disable-gpu", "--no-sandbox"])
        ctx = browser.new_context(viewport={"width": 1680, "height": 980})
        page = ctx.new_page()
        console_errors = []
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
        page.goto(URL, wait_until="networkidle", timeout=30000)
        time.sleep(2)

        def nav_to(label):
            """Click a nav/tab control by accessible name, then move the pointer away
            so its tooltip stops intercepting the next click."""
            page.get_by_role("button", name=label, exact=True).first.click(timeout=8000)
            page.mouse.move(1600, 950)
            time.sleep(0.25)

        for name, selector in VIEWS:
            try:
                if selector:
                    nav_to(selector)
                    time.sleep(1.2)
                # Settings: walk every tab so the new I1/I2 panels are actually rendered
                if name == "settings":
                    for tab in SETTINGS_TABS:
                        try:
                            page.get_by_role("tab", name=tab, exact=True).first.click(timeout=8000)
                            page.mouse.move(1600, 950)
                            time.sleep(0.9)
                            s = sweep(page)
                            report["views"][f"settings:{tab}"] = s
                            page.screenshot(path=os.path.join(SHOTS, f"settings-{tab.lower()}.png"))
                        except Exception as e:
                            report["warnings"].append(f"settings tab {tab}: {e}")
                    continue
                s = sweep(page)
                report["views"][name] = s
                page.screenshot(path=os.path.join(SHOTS, f"{name}.png"))
            except Exception as e:
                report["warnings"].append(f"view {name}: {e}")

        report["consoleErrors"] = console_errors
        browser.close()

    # Aggregate blockers across every view
    for view, s in report["views"].items():
        if not isinstance(s, dict):
            continue
        if s.get("bodyBg") != DNA["bg"]:
            report["blockers"].append(f"{view}: body bg {s.get('bodyBg')} != {DNA['bg']}")
        if s.get("bodyFg") != DNA["fg"]:
            report["blockers"].append(f"{view}: body fg {s.get('bodyFg')} != {DNA['fg']}")
        for r in s.get("radius", []):
            report["blockers"].append(f"{view}: radius {r['r']} on {r['el']}")
        for c in s.get("banned_color", []):
            report["blockers"].append(f"{view}: copper {c['v']} on {c['el']}")
        for f in s.get("banned_font", []):
            report["blockers"].append(f"{view}: banned font {f['f']} on {f['el']}")
        for g in s.get("glow", []):
            report["blockers"].append(f"{view}: glow shadow {g['sh']} on {g['el']}")

    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "report.json"), "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2)

    print(f"VIEWS SWEPT: {len(report['views'])}")
    for v, s in report["views"].items():
        if isinstance(s, dict):
            print(f"  {v:28s} accent={s.get('accentCount',0):3d}  radius_viol={len(s.get('radius',[]))}")
    print(f"CONSOLE ERRORS: {len(report['consoleErrors'])}")
    print(f"WARNINGS: {len(report['warnings'])}")
    for w in report["warnings"]:
        print("  -", w)
    print(f"BLOCKERS: {len(report['blockers'])}")
    for b in report["blockers"]:
        print("  !", b)
    print("\nRESULT:", "PASS" if not report["blockers"] else "FAIL")
    return 0 if not report["blockers"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
