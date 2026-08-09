"""P3 computed-style sweep — verify rendered DOM matches the design DNA.

Checks: body bg #0e0e0e, text #f4f4f4, Geist fonts loaded, all border-radius
0px (except 50%/9999px dots), terminal green #85ed75 accent present, and no
copper / old-font / gray-shade drift in computed styles.
"""
from playwright.sync_api import sync_playwright
import json
import os
import time

URL = "http://localhost:1420/"
OUT = os.path.join(os.path.dirname(__file__), "p3-shots")
os.makedirs(OUT, exist_ok=True)

# Colors that must NOT appear anywhere (drift)
BANNED = {
    "copper": ["rgb(201, 138, 91)", "rgb(214, 160, 119)", "#c98a5b", "#d6a077"],
    "old_fonts": ["Space Grotesk", "JetBrains Mono", "Inter"],
    "gray_shades": ["rgb(161, 161, 170)", "rgb(138, 143, 152)", "rgb(110, 115, 128)"],
}


def main() -> int:
    findings = {"radius_violations": [], "banned_color": [], "banned_font": [], "banned_gray": []}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--disable-gpu", "--no-sandbox"])
        ctx = browser.new_context(viewport={"width": 1680, "height": 980})
        page = ctx.new_page()
        page.goto(URL, wait_until="networkidle", timeout=20000)
        time.sleep(2)

        # Body-level checks
        body = page.evaluate("""() => {
            const b = getComputedStyle(document.body);
            return { bg: b.backgroundColor, color: b.color, font: b.fontFamily };
        }""")
        print("BODY:", json.dumps(body))

        # Sweep all elements
        sweep = page.evaluate("""() => {
            const out = { radius: [], colors: new Set(), fonts: new Set(), accentCount: 0 };
            const els = document.querySelectorAll('*');
            for (const el of els) {
                const s = getComputedStyle(el);
                const r = s.borderRadius;
                // allow 0px, 50%, 9999px, and empty
                if (r && r !== '0px' && r !== '50%' && r !== '9999px' && r !== '0px 0px 0px 0px') {
                    out.radius.push({ tag: el.tagName, cls: el.className, r });
                }
                const c = s.color;
                if (c) out.colors.add(c);
                const bg = s.backgroundColor;
                if (bg && bg !== 'rgba(0, 0, 0, 0)') out.colors.add(bg);
                const f = s.fontFamily;
                if (f) out.fonts.add(f);
                if (c === 'rgb(133, 237, 117)' || bg === 'rgb(133, 237, 117)') out.accentCount++;
            }
            return { radius: out.radius.slice(0, 40), colors: [...out.colors], fonts: [...out.fonts], accentCount: out.accentCount };
        }""")

        print("RADIUS VIOLATIONS:", json.dumps(sweep["radius"]))
        print("ACCENT (#85ed75) ELEMENT COUNT:", sweep["accentCount"])
        print("FONTS:", json.dumps(sweep["fonts"]))

        # Check banned colors/fonts
        for c in sweep["colors"]:
            cl = c.lower()
            for name, banned in BANNED.items():
                for b in banned:
                    if b.lower() in cl:
                        findings[name].append(c)
        for f in sweep["fonts"]:
            fl = f.lower()
            for b in BANNED["old_fonts"]:
                if b.lower() in fl:
                    findings["banned_font"].append(f)

        findings["radius_violations"] = sweep["radius"]
        browser.close()

    with open(os.path.join(OUT, "computed-sweep.json"), "w") as f:
        json.dump({"body": body, "sweep": sweep, "findings": findings}, f, indent=2)
    print("\nFINDINGS:", json.dumps(findings, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
