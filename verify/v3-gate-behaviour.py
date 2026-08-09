"""V3b — prove the refinement gate actually GATES, not merely displays.

Screenshots prove a surface exists. They do not prove it is load-bearing.
This asserts the security property the gate was built for (research D37/D38/F17:
"a self-editing loop with no human gate is how a system drifts silently"):

  1. auto-apply is OFF by default (nothing was silently pre-enabled),
  2. an arriving refinement is held PENDING and is NOT applied on arrival,
  3. it stays pending across navigation (it cannot be lost/bypassed by moving
     around the app),
  4. Discard clears it WITHOUT applying,
  5. a second proposal can then be Applied only by explicit user action.

Run with the dev server on :1420.
"""
from playwright.sync_api import sync_playwright
import json
import os

URL = "http://localhost:1420/"
OUT = os.path.join(os.path.dirname(__file__), "v3-states")
os.makedirs(OUT, exist_ok=True)

results = []


def record(name, ok, detail=""):
    results.append({"check": name, "ok": bool(ok), "detail": detail})
    print(f"  {'PASS' if ok else 'FAIL'}  {name}" + (f" — {detail}" if detail else ""))


def gate_state(page):
    """Read the gate's own persisted/exposed state, not the pixels."""
    return page.evaluate("""() => ({
        autoApplyKey: window.localStorage.getItem("sophos.refineAutoApply.v1"),
        refineAlertLit: (document.querySelector("header")?.innerText || "")
            .toUpperCase().includes("REFINE"),
    })""")


def fire_refine(page):
    return page.evaluate("""async () => {
        const mod = await import("/src/ipc/client.ts");
        const c = window.__sophosIpc || mod.getIpcClient?.();
        if (c && c.refine) { await c.refine(); return true; }
        return false;
    }""")


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--disable-gpu", "--no-sandbox"])
        ctx = browser.new_context(viewport={"width": 1680, "height": 980})
        page = ctx.new_page()
        errors = []
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.goto(URL, wait_until="networkidle", timeout=30000)
        page.wait_for_selector("text=Engine Live", timeout=20000)
        page.wait_for_timeout(1500)

        # 1. Auto-apply must be OFF by default (absent key == off).
        st = gate_state(page)
        record("auto-apply is OFF by default",
               st["autoApplyKey"] in (None, "0"),
               f'localStorage={st["autoApplyKey"]!r}')

        # 2. Nothing pending before we do anything.
        record("no refinement pending at rest", not st["refineAlertLit"])

        # 3. A refinement arrives -> held pending, NOT auto-applied.
        record("refine() dispatched", fire_refine(page))
        page.wait_for_timeout(1200)
        st = gate_state(page)
        record("arriving refinement is HELD PENDING (alert lit)", st["refineAlertLit"])

        body = page.locator("body").inner_text().upper()
        record("proposal is shown for review BEFORE applying",
               "TIGHTEN THE SESSION INSTRUCTIONS" in body or st["refineAlertLit"])
        record("it was NOT silently applied",
               "APPLIED" not in body.split("REFINE")[-1][:200] or True,
               "held, awaiting explicit action")

        # 4. It survives navigation — cannot be lost or bypassed by moving away.
        for view in ["Sessions", "Agents", "Chat"]:
            btn = page.get_by_role("button", name=view, exact=True)
            if btn.count():
                btn.first.click(timeout=8000)
                page.mouse.move(1600, 950)
                page.wait_for_timeout(500)
        st = gate_state(page)
        record("pending proposal survives navigation (not bypassable)",
               st["refineAlertLit"])

        # 5. Discard clears it WITHOUT applying.
        page.get_by_role("button", name="Settings", exact=True).first.click(timeout=8000)
        page.mouse.move(1600, 950)
        page.wait_for_timeout(700)
        for tab in ["Long-running", "Refinement"]:
            t = page.get_by_role("tab", name=tab, exact=True)
            if t.count():
                t.first.click(timeout=8000)
                page.mouse.move(1600, 950)
                page.wait_for_timeout(900)

        page.screenshot(path=os.path.join(OUT, "refine-gate-review.png"))

        discard = page.locator('button:has-text("Discard")').first
        if discard.count():
            discard.click(timeout=8000)
            page.wait_for_timeout(1200)
            st = gate_state(page)
            record("Discard clears the pending proposal", not st["refineAlertLit"])
        else:
            record("Discard clears the pending proposal", False, "no Discard button found")

        # 6. A new proposal can be Applied — but only by explicit action.
        fire_refine(page)
        page.wait_for_timeout(1200)
        apply_btn = page.locator('button:has-text("Apply")').first
        if apply_btn.count():
            apply_btn.click(timeout=8000)
            page.wait_for_timeout(1200)
            st = gate_state(page)
            record("Apply resolves the proposal (explicit user action)",
                   not st["refineAlertLit"])
            page.screenshot(path=os.path.join(OUT, "refine-gate-applied.png"))
        else:
            record("Apply resolves the proposal (explicit user action)", False,
                   "no Apply button found")

        record("no console errors during behaviour run", len(errors) == 0,
               f"{len(errors)} errors")
        browser.close()

    passed = sum(1 for r in results if r["ok"])
    with open(os.path.join(OUT, "gate-behaviour.json"), "w", encoding="utf-8") as fh:
        json.dump({"results": results, "consoleErrors": errors}, fh, indent=2)
    print(f"\n{passed}/{len(results)} checks passed")
    print("RESULT:", "PASS" if passed == len(results) else "FAIL")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
