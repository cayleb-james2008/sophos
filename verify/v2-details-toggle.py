"""V2 — prove the slimmed SystemBar behaves: essentials always visible,
secondary telemetry reachable behind the Details toggle, and the panel
dismissible (outside click + Escape) without trapping focus.

Also captures the OPEN state so the vision critic can judge a surface that the
default screenshots never reach (the D8/D13 evidence-gap lesson).
"""
from playwright.sync_api import sync_playwright
import json
import os

URL = "http://localhost:1420/"
OUT = os.path.join(os.path.dirname(__file__), "v1-visual")
SHOTS = os.path.join(OUT, "shots")
os.makedirs(SHOTS, exist_ok=True)

# Secondary telemetry that must NOT be in the resting bar, but MUST be reachable.
SECONDARY = ["Directory", "Session cost", "Autonomous", "Refinement"]
# Essentials that must always be on screen.
ESSENTIAL = ["Engine Live", "Model", "Ctx"]


def bar_text(page):
    # Labels are uppercased via CSS `text-transform`, so inner_text() returns
    # them upper-cased regardless of the source casing. Compare case-insensitively.
    return page.locator("header").first.inner_text().upper()


def main() -> int:
    checks = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--disable-gpu", "--no-sandbox"])
        ctx = browser.new_context(viewport={"width": 1680, "height": 980})
        page = ctx.new_page()
        errors = []
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.goto(URL, wait_until="networkidle", timeout=30000)
        page.wait_for_selector("text=Engine Live", timeout=20000)
        page.wait_for_timeout(1200)

        # 1. Essentials are visible at rest.
        resting = bar_text(page)
        for e in ESSENTIAL:
            checks.append((f"essential '{e}' visible at rest", e.upper() in resting))

        # 2. Secondary telemetry is NOT cluttering the resting bar.
        for s in SECONDARY:
            checks.append((f"secondary '{s}' hidden at rest", s.upper() not in resting))

        # 3. Resting bar is materially slimmer (segment count proxy: line count).
        resting_lines = len([l for l in resting.split("\n") if l.strip()])
        checks.append((f"resting bar is compact ({resting_lines} lines <= 12)", resting_lines <= 12))
        page.screenshot(path=os.path.join(SHOTS, "systembar-resting.png"))

        # 4. Details toggle reveals the secondary telemetry.
        page.get_by_role("button", name="Session details").click(timeout=8000)
        page.wait_for_timeout(600)
        opened = page.locator('[role="dialog"][aria-label="Session details"]')
        checks.append(("details panel opens", opened.count() > 0))
        panel = (opened.first.inner_text() if opened.count() else "").upper()
        for s in SECONDARY:
            checks.append((f"secondary '{s}' reachable in panel", s.upper() in panel))
        page.screenshot(path=os.path.join(SHOTS, "systembar-details-open.png"))

        # 5. Escape closes it (and must not be trapped).
        page.keyboard.press("Escape")
        page.wait_for_timeout(500)
        checks.append(("Escape closes panel",
                       page.locator('[role="dialog"][aria-label="Session details"]').count() == 0))

        # 6. Outside click closes it.
        page.get_by_role("button", name="Session details").click(timeout=8000)
        page.wait_for_timeout(400)
        page.mouse.click(840, 700)
        page.wait_for_timeout(500)
        checks.append(("outside click closes panel",
                       page.locator('[role="dialog"][aria-label="Session details"]').count() == 0))

        # 7. App still works after all that (composer reachable).
        checks.append(("app still interactive", page.locator("textarea").count() > 0))

        browser.close()

    passed = sum(1 for _, ok in checks if ok)
    for name, ok in checks:
        print(f"  {'PASS' if ok else 'FAIL'}  {name}")
    print(f"\n{passed}/{len(checks)} checks passed · console errors: {len(errors)}")
    for e in errors[:5]:
        print("  console:", e[:120])

    with open(os.path.join(OUT, "details-toggle.json"), "w", encoding="utf-8") as fh:
        json.dump({"checks": [{"name": n, "ok": o} for n, o in checks],
                   "consoleErrors": errors}, fh, indent=2)

    ok = passed == len(checks) and not errors
    print("RESULT:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
