"""Gauntlet piece verify: Sessions graph drag-to-arrange + responsive detail
inspector. Run against the live vite dev server on localhost:1420.

  Part A: drag a session node -> position persists after enrichment refresh;
          Reset layout reapplies dagre.
  Part B: side-by-side above 900px; below 900px inspector hidden by default,
          toggle surfaces it as an overlay, no horizontal overflow at
          1440 / 900 / 768px, no console errors.

Screenshots -> verify/visual/sessions-responsive/*.png
"""
from playwright.sync_api import sync_playwright
import json, os, re

URL = "http://localhost:1420/"
OUT = os.path.join(os.path.dirname(__file__), "visual", "sessions-responsive")
os.makedirs(OUT, exist_ok=True)

results = []


def record(name, ok, detail=""):
    results.append({"check": name, "ok": bool(ok), "detail": detail})
    print(f"  {'PASS' if ok else 'FAIL'}  {name}" + (f" — {detail}" if detail else ""))


def node_box(page, kind_text):
    """Return the first react-flow node whose kind label matches."""
    nodes = page.query_selector_all(".react-flow__node")
    for n in nodes:
        kind = n.query_selector(".pg-node__kind")
        if kind and kind.inner_text().strip() == kind_text:
            return n
    return None


def node_pos(page, node):
    box = node.bounding_box()
    return box


def has_hscroll(page):
    return page.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth")


def goto_sessions(page):
    """Wait for the app shell, navigate to the Sessions view, wait for it."""
    page.wait_for_timeout(1500)
    clicked = False
    try:
        page.get_by_role("button", name="Sessions", exact=True).first.click(timeout=4000)
        clicked = True
    except Exception:
        pass
    if not clicked:
        # Below the label breakpoint the sidebar collapses to an icon rail
        # (labels hidden), so fall back to the second nav item (Chat, Sessions,
        # Agents, Inbox, Settings).
        page.locator(".sidebar__nav button").nth(1).click(timeout=6000)
    page.wait_for_selector("text=Session command center", timeout=15000)
    page.wait_for_timeout(1200)


def console_right(page):
    box = page.query_selector(".sessions__console--graph").bounding_box()
    return box["x"] + box["width"]


def inspector_hidden(page):
    """The overlay inspector is hidden when its left edge is at/right of the
    console's right edge (fully clipped by the console's overflow:hidden)."""
    dv = page.query_selector(".sessions__detailwrap").bounding_box()
    return bool(dv) and dv["x"] >= console_right(page) - 2


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--disable-gpu", "--no-sandbox"])
        errors = []

        # ---------------------------------------------------------------
        # 1440px — side-by-side baseline
        # ---------------------------------------------------------------
        print("\n=== 1440px — side by side ===")
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.goto(URL, wait_until="networkidle", timeout=30000)
        goto_sessions(page)
        page.screenshot(path=os.path.join(OUT, "1440-side-by-side.png"), full_page=False)

        # inspector visible as grid column
        detail = page.query_selector(".sessions__detailwrap")
        dv = detail.bounding_box()
        toggle_visible = page.is_visible(".sessions__inspector-toggle")
        record("1440 inspector side-by-side visible", bool(dv and dv["width"] > 250), f"w={dv and dv['width']:.0f}")
        record("1440 toggle hidden", not toggle_visible)
        record("1440 no horizontal overflow", not has_hscroll(page))
        record("1440 reset-layout button present", page.is_visible(".sessions__resetlayout"))

        # ---- Part A: drag persistence + reset ----
        print("\n=== Part A — drag persistence ===")
        session_node = node_box(page, "SESSION")
        record("a session node found", session_node is not None)
        if session_node:
            b1 = session_node.bounding_box()
            cx, cy = b1["x"] + b1["width"] / 2, b1["y"] + b1["height"] / 2
            page.mouse.move(cx, cy)
            page.mouse.down()
            page.mouse.move(cx + 130, cy + 60, steps=8)
            page.mouse.up()
            page.wait_for_timeout(400)
            b2 = node_box(page, "SESSION").bounding_box()
            moved = abs(b2["x"] - b1["x"]) > 60 or abs(b2["y"] - b1["y"]) > 30
            record("node drag moved the node", moved, f"({b1['x']:.0f},{b1['y']:.0f})->({b2['x']:.0f},{b2['y']:.0f})")
            before = (b2["x"], b2["y"])

            # Trigger an enrichment refresh (Refresh button recomputes layout)
            page.get_by_role("button", name="Refresh", exact=True).first.click(timeout=5000)
            page.wait_for_timeout(1400)
            b3 = node_box(page, "SESSION").bounding_box()
            kept = abs(b3["x"] - before[0]) < 3 and abs(b3["y"] - before[1]) < 3
            record("dragged position persists after refresh", kept, f"before={before} after=({b3['x']:.0f},{b3['y']:.0f})")

            # Reset layout reapplies dagre
            page.get_by_role("button", name="Reset layout", exact=True).first.click(timeout=5000)
            page.wait_for_timeout(500)
            b4 = node_box(page, "SESSION").bounding_box()
            reset_back = abs(b4["x"] - before[0]) > 3 or abs(b4["y"] - before[1]) > 3
            record("Reset layout reapplied dagre (node moved back)", reset_back,
                   f"after-reset=({b4['x']:.0f},{b4['y']:.0f})")
        ctx.close()

        # ---------------------------------------------------------------
        # 900px — collapsed, toggle appears, no overflow
        # ---------------------------------------------------------------
        print("\n=== 900px — collapsed inspector ===")
        ctx = browser.new_context(viewport={"width": 900, "height": 800})
        page = ctx.new_page()
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.goto(URL, wait_until="networkidle", timeout=30000)
        goto_sessions(page)

        dv = page.query_selector(".sessions__detailwrap").bounding_box()
        # in closed state, overlay is translated off-screen right (x >= console right)
        toggle_visible = page.is_visible(".sessions__inspector-toggle")
        record("900 inspector hidden by default", inspector_hidden(page), f"x={dv and dv['x']:.0f} consoleRight={console_right(page):.0f}")
        record("900 toggle appears", toggle_visible)
        record("900 no horizontal overflow (closed)", not has_hscroll(page))
        page.screenshot(path=os.path.join(OUT, "900-collapsed.png"))

        # Open overlay
        page.get_by_role("button", name="Inspect", exact=True).first.click(timeout=5000)
        page.wait_for_timeout(500)
        ov = page.query_selector(".sessions__detailwrap").bounding_box()
        record("900 inspector opens as overlay", ov and ov["x"] < 600 and ov["width"] > 300,
               f"x={ov and ov['x']:.0f} w={ov and ov['width']:.0f}")
        record("900 backdrop visible", page.is_visible(".sessions__inspector-backdrop"))
        record("900 close button visible", page.is_visible(".sessions__inspector-close"))
        record("900 no horizontal overflow (open)", not has_hscroll(page))
        page.screenshot(path=os.path.join(OUT, "900-overlay-open.png"))
        # close via backdrop
        page.click(".sessions__inspector-backdrop", position={"x": 30, "y": 30})
        page.wait_for_timeout(400)
        record("900 closes via backdrop", inspector_hidden(page))
        ctx.close()

        # ---------------------------------------------------------------
        # 768px — same behavior
        # ---------------------------------------------------------------
        print("\n=== 768px ===")
        ctx = browser.new_context(viewport={"width": 768, "height": 800})
        page = ctx.new_page()
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.goto(URL, wait_until="networkidle", timeout=30000)
        goto_sessions(page)

        dv = page.query_selector(".sessions__detailwrap").bounding_box()
        record("768 inspector hidden by default", inspector_hidden(page), f"x={dv and dv['x']:.0f} consoleRight={console_right(page):.0f}")
        record("768 toggle appears", page.is_visible(".sessions__inspector-toggle"))
        record("768 no horizontal overflow (closed)", not has_hscroll(page))
        page.screenshot(path=os.path.join(OUT, "768-collapsed.png"))

        page.get_by_role("button", name="Inspect", exact=True).first.click(timeout=5000)
        page.wait_for_timeout(500)
        ov = page.query_selector(".sessions__detailwrap").bounding_box()
        record("768 inspector opens as overlay", ov and ov["x"] < 600 and ov["width"] > 300,
               f"x={ov and ov['x']:.0f} w={ov and ov['width']:.0f}")
        record("768 no horizontal overflow (open)", not has_hscroll(page))
        page.screenshot(path=os.path.join(OUT, "768-overlay-open.png"))
        ctx.close()

        # ---------------------------------------------------------------
        print("\n=== Console errors ===")
        record("no console errors at any width", len(errors) == 0, f"count={len(errors)}")
        for e in errors[:10]:
            print("   ERR:", e)

        browser.close()

    ok = all(r["ok"] for r in results)
    with open(os.path.join(OUT, "report.json"), "w") as f:
        json.dump({"all_pass": ok, "results": results}, f, indent=2)
    print(f"\n=== {'ALL PASS' if ok else 'SOME FAIL'} ===")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
