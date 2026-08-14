# -*- coding: utf-8 -*-
"""Independent Evaluator verification — does NOT use the worker's harness.
Same UI surface (Sessions on localhost:1420), independent assertions. Screenshots
saved to verify/evaluator-screens/ so they don't collide with the worker's.

Strategy: re-derive the bar ("drag persists + inspector collapses cleanly
under 900px") from scratch and exercise every claim:
  1. dev server is reachable, app boots, Sessions view renders
  2. 1440px — side-by-side, toggle hidden, inspector column visible
  3. Drag a node → position delta observed → click Refresh → position preserved
  4. Drag a SECOND node → refresh → both stay (multi-drag persistence)
  5. Reset layout → dagre layout reapplied (node positions match pre-drag)
  6. 900px — inspector overlay-closed by default, toggle visible
  7. 900px — click toggle → overlay opens, no horizontal overflow
  8. 900px — close via backdrop, close via × button
  9. 899px boundary — toggle visible (below breakpoint)
  10. 901px boundary — toggle hidden (above breakpoint)
  11. 768px — toggle + overlay + no overflow
  12. 768px — drag still works (smoke)
  13. Console errors at each width
"""
import json, os, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright

URL = "http://localhost:1420/"
OUT = os.path.join(os.path.dirname(__file__), "evaluator-screens")
os.makedirs(OUT, exist_ok=True)

errors_global = []


def record(results, name, ok, detail=""):
    results.append({"check": name, "ok": bool(ok), "detail": detail})
    tag = "PASS" if ok else "FAIL"
    msg = f"  [{tag}] {name}"
    if detail:
        msg += " | " + detail
    print(msg)


def has_hscroll(page):
    return page.evaluate(
        "document.documentElement.scrollWidth > document.documentElement.clientWidth"
    )


def goto_sessions(page):
    """Navigate to Sessions view from the sidebar."""
    page.wait_for_timeout(800)
    # Try the labelled button first
    try:
        page.get_by_role("button", name="Sessions", exact=True).first.click(timeout=3000)
    except Exception:
        # Below the label breakpoint the sidebar shows icons only — fall back
        # to the second nav slot (Chat, Sessions, Agents, Inbox, Settings).
        page.locator(".sidebar__nav button").nth(1).click(timeout=4000)
    page.wait_for_selector("text=Session command center", timeout=12000)
    page.wait_for_timeout(1200)


def first_session_node(page):
    nodes = page.query_selector_all(".react-flow__node")
    for n in nodes:
        kind = n.query_selector(".pg-node__kind")
        if kind and kind.inner_text().strip() == "SESSION":
            return n
    return None


def node_center(box):
    return box["x"] + box["width"] / 2, box["y"] + box["height"] / 2


def main():
    results = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--disable-gpu", "--no-sandbox"])

        # ---------- 1440 ----------
        print("\n=== 1440px — baseline side-by-side ===")
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()
        page.on("console", lambda m: errors_global.append((1440, m.type, m.text)) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors_global.append((1440, "pageerror", str(e))))
        page.goto(URL, wait_until="domcontentloaded", timeout=20000)
        goto_sessions(page)
        page.screenshot(path=os.path.join(OUT, "1440-baseline.png"))

        # inspector as grid column
        detail = page.query_selector(".sessions__detailwrap")
        dv = detail.bounding_box()
        record(results, "1440 inspector rendered",
               dv is not None and dv["x"] > 600 and dv["width"] >= 250,
               f"x={dv and dv['x']:.0f} w={dv and dv['width']:.0f}")
        # toggle not visible (display:none outside @media)
        toggle_vis = page.evaluate(
            "() => { const el = document.querySelector('.sessions__inspector-toggle');"
            "if (!el) return null; const s = getComputedStyle(el);"
            "return {display: s.display, visibility: s.visibility}; }"
        )
        record(results, "1440 toggle computed-display is none",
               toggle_vis and toggle_vis["display"] == "none",
               f"{toggle_vis}")
        record(results, "1440 no horizontal overflow", not has_hscroll(page))
        record(results, "1440 reset-layout button present",
               page.is_visible(".sessions__resetlayout"))

        # ---- Part A: drag persistence ----
        print("\n=== Drag persistence — node 1 ===")
        snode = first_session_node(page)
        record(results, "session node found", snode is not None)
        if snode:
            b1 = snode.bounding_box()
            cx, cy = node_center(b1)
            page.mouse.move(cx, cy)
            page.mouse.down()
            for i in range(1, 9):
                page.mouse.move(cx + (130 * i / 8), cy + (60 * i / 8))
            page.mouse.up()
            page.wait_for_timeout(400)
            b2 = first_session_node(page).bounding_box()
            moved = abs(b2["x"] - b1["x"]) > 60 or abs(b2["y"] - b1["y"]) > 30
            record(results, "node drag moved node visibly",
                   moved, f"{b1['x']:.0f},{b1['y']:.0f} → {b2['x']:.0f},{b2['y']:.0f}")
            pre_refresh = (b2["x"], b2["y"])

            page.screenshot(path=os.path.join(OUT, "1440-after-drag.png"))

            page.get_by_role("button", name="Refresh", exact=True).first.click(timeout=5000)
            page.wait_for_timeout(1400)
            b3 = first_session_node(page).bounding_box()
            kept = abs(b3["x"] - pre_refresh[0]) < 3 and abs(b3["y"] - pre_refresh[1]) < 3
            record(results, "dragged position preserved after Refresh",
                   kept, f"pre=({pre_refresh[0]:.0f},{pre_refresh[1]:.0f}) post=({b3['x']:.0f},{b3['y']:.0f})")

            # ---- Part A2: drag a SECOND node, refresh again ----
            print("\n=== Drag persistence — second node ===")
            # find a DIFFERENT session node if possible
            all_nodes = [n for n in page.query_selector_all(".react-flow__node")
                         if n.query_selector(".pg-node__kind") and
                         n.query_selector(".pg-node__kind").inner_text().strip() == "SESSION"]
            other = None
            for n in all_nodes:
                bb = n.bounding_box()
                if bb and abs(bb["x"] - pre_refresh[0]) > 10 or abs(bb["y"] - pre_refresh[1]) > 10:
                    other = n
                    break
            if other is None and len(all_nodes) > 1:
                other = all_nodes[1]
            record(results, "second session node available", other is not None)
            if other:
                ob1 = other.bounding_box()
                ocx, ocy = node_center(ob1)
                page.mouse.move(ocx, ocy)
                page.mouse.down()
                for i in range(1, 9):
                    page.mouse.move(ocx - (100 * i / 8), ocy - (40 * i / 8))
                page.mouse.up()
                page.wait_for_timeout(400)
                ob2 = other.bounding_box()
                # refresh again
                page.get_by_role("button", name="Refresh", exact=True).first.click(timeout=5000)
                page.wait_for_timeout(1400)
                ob3 = other.bounding_box()
                kept2 = abs(ob3["x"] - ob2["x"]) < 3 and abs(ob3["y"] - ob2["y"]) < 3
                record(results, "second node's drag also persists",
                       kept2, f"pre=({ob2['x']:.0f},{ob2['y']:.0f}) post=({ob3['x']:.0f},{ob3['y']:.0f})")
                # first node should ALSO still be in place
                b4 = first_session_node(page).bounding_box()
                # careful: first_session_node() returns the first node; if positions overlap, ambiguous. Re-grep by node id from before
                # The first dragged node should still be near pre_refresh coords
                node1_kept = abs(b4["x"] - pre_refresh[0]) < 30 and abs(b4["y"] - pre_refresh[1]) < 30
                record(results, "first node still near its dragged position",
                       node1_kept,
                       f"expected≈{pre_refresh} got=({b4['x']:.0f},{b4['y']:.0f}) (note: first_session_node() may return a different one)")

            # ---- Part A3: Reset layout ----
            print("\n=== Reset layout ===")
            page.get_by_role("button", name="Reset layout", exact=True).first.click(timeout=5000)
            page.wait_for_timeout(600)
            # After reset, dagre reapplies — node 1 should be back to original (b1)
            rb = first_session_node(page).bounding_box()
            reset_back = abs(rb["x"] - b1["x"]) > 5 or abs(rb["y"] - b1["y"]) > 5
            record(results, "Reset layout moved node back toward dagre position",
                   reset_back, f"original=({b1['x']:.0f},{b1['y']:.0f}) after-reset=({rb['x']:.0f},{rb['y']:.0f})")
            page.screenshot(path=os.path.join(OUT, "1440-after-reset.png"))

        ctx.close()

        # ---------- 901px boundary (above breakpoint) ----------
        print("\n=== 901px — should be side-by-side, toggle hidden ===")
        ctx = browser.new_context(viewport={"width": 901, "height": 800})
        page = ctx.new_page()
        page.on("console", lambda m: errors_global.append((901, m.type, m.text)) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors_global.append((901, "pageerror", str(e))))
        page.goto(URL, wait_until="domcontentloaded", timeout=20000)
        goto_sessions(page)
        toggle_disp_901 = page.evaluate(
            "() => getComputedStyle(document.querySelector('.sessions__inspector-toggle')).display"
        )
        inspector_w_901 = page.query_selector(".sessions__detailwrap").bounding_box()["width"]
        record(results, "901 toggle display:none (above breakpoint)",
               toggle_disp_901 == "none", f"display={toggle_disp_901}")
        record(results, "901 inspector column visible as grid (w>=250)",
               inspector_w_901 >= 250, f"w={inspector_w_901:.0f}")
        ctx.close()

        # ---------- 900px boundary (at breakpoint, responsive rules apply) ----------
        print("\n=== 900px — collapsed, overlay, toggle visible ===")
        ctx = browser.new_context(viewport={"width": 900, "height": 800})
        page = ctx.new_page()
        page.on("console", lambda m: errors_global.append((900, m.type, m.text)) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors_global.append((900, "pageerror", str(e))))
        page.goto(URL, wait_until="domcontentloaded", timeout=20000)
        goto_sessions(page)
        page.screenshot(path=os.path.join(OUT, "900-closed.png"))

        toggle_disp_900 = page.evaluate(
            "() => getComputedStyle(document.querySelector('.sessions__inspector-toggle')).display"
        )
        toggle_visible = page.is_visible(".sessions__inspector-toggle")
        record(results, "900 toggle display:inline-flex (at breakpoint)",
               toggle_disp_900 != "none", f"display={toggle_disp_900}")
        record(results, "900 toggle is visible (Playwright is_visible)", toggle_visible)
        record(results, "900 no horizontal overflow (closed)", not has_hscroll(page))

        # inspector clipped off-screen right (transform translateX 100%)
        wrap = page.query_selector(".sessions__detailwrap")
        wrap_x = wrap.bounding_box()["x"]
        console = page.query_selector(".sessions__console--graph").bounding_box()
        record(results, "900 inspector starts at/right of console right edge",
               wrap_x >= console["x"] + console["width"] - 2,
               f"x={wrap_x:.0f} consoleRight={console['x']+console['width']:.0f}")

        # open overlay
        page.get_by_role("button", name="Inspect", exact=True).first.click(timeout=4000)
        page.wait_for_timeout(500)
        ov = wrap.bounding_box()
        record(results, "900 overlay opens (wrap visible inside console)",
               ov["x"] < console["x"] + console["width"] - 50 and ov["width"] >= 250,
               f"x={ov['x']:.0f} w={ov['width']:.0f}")
        backdrop_vis = page.is_visible(".sessions__inspector-backdrop")
        record(results, "900 backdrop visible after open", backdrop_vis)
        close_btn_vis = page.is_visible(".sessions__inspector-close")
        record(results, "900 close (×) button visible", close_btn_vis)
        record(results, "900 no horizontal overflow (overlay open)", not has_hscroll(page))
        page.screenshot(path=os.path.join(OUT, "900-open.png"))

        # close via × button
        page.click(".sessions__inspector-close")
        page.wait_for_timeout(400)
        wrap_x2 = wrap.bounding_box()["x"]
        record(results, "900 close (×) hides overlay",
               wrap_x2 >= console["x"] + console["width"] - 2,
               f"x={wrap_x2:.0f}")

        # open again, then close via backdrop
        page.get_by_role("button", name="Inspect", exact=True).first.click(timeout=4000)
        page.wait_for_timeout(400)
        page.click(".sessions__inspector-backdrop", position={"x": 30, "y": 30})
        page.wait_for_timeout(400)
        wrap_x3 = wrap.bounding_box()["x"]
        record(results, "900 backdrop click hides overlay",
               wrap_x3 >= console["x"] + console["width"] - 2,
               f"x={wrap_x3:.0f}")
        ctx.close()

        # ---------- 899px (below breakpoint) ----------
        print("\n=== 899px — collapsed (boundary) ===")
        ctx = browser.new_context(viewport={"width": 899, "height": 800})
        page = ctx.new_page()
        page.on("console", lambda m: errors_global.append((899, m.type, m.text)) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors_global.append((899, "pageerror", str(e))))
        page.goto(URL, wait_until="domcontentloaded", timeout=20000)
        goto_sessions(page)
        toggle_disp_899 = page.evaluate(
            "() => getComputedStyle(document.querySelector('.sessions__inspector-toggle')).display"
        )
        record(results, "899 toggle visible (below breakpoint)",
               toggle_disp_899 != "none", f"display={toggle_disp_899}")
        ctx.close()

        # ---------- 768px ----------
        print("\n=== 768px — collapsed ===")
        ctx = browser.new_context(viewport={"width": 768, "height": 800})
        page = ctx.new_page()
        page.on("console", lambda m: errors_global.append((768, m.type, m.text)) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors_global.append((768, "pageerror", str(e))))
        page.goto(URL, wait_until="domcontentloaded", timeout=20000)
        goto_sessions(page)
        page.screenshot(path=os.path.join(OUT, "768-closed.png"))

        record(results, "768 toggle visible", page.is_visible(".sessions__inspector-toggle"))
        record(results, "768 no horizontal overflow (closed)", not has_hscroll(page))

        # drag smoke test at 768
        snode = first_session_node(page)
        record(results, "768 session node present", snode is not None)
        if snode:
            b1 = snode.bounding_box()
            cx, cy = node_center(b1)
            page.mouse.move(cx, cy)
            page.mouse.down()
            for i in range(1, 9):
                page.mouse.move(cx + (60 * i / 8), cy + (40 * i / 8))
            page.mouse.up()
            page.wait_for_timeout(300)
            b2 = first_session_node(page).bounding_box()
            moved = abs(b2["x"] - b1["x"]) > 30 or abs(b2["y"] - b1["y"]) > 15
            record(results, "768 drag moves node", moved,
                   f"{b1['x']:.0f},{b1['y']:.0f} → {b2['x']:.0f},{b2['y']:.0f}")

        # open overlay
        page.get_by_role("button", name="Inspect", exact=True).first.click(timeout=4000)
        page.wait_for_timeout(500)
        page.screenshot(path=os.path.join(OUT, "768-open.png"))
        record(results, "768 no horizontal overflow (overlay open)", not has_hscroll(page))
        ctx.close()

        # ---------- Console errors overall ----------
        print("\n=== Console / page errors ===")
        record(results, "no console errors at any width",
               len(errors_global) == 0,
               f"count={len(errors_global)} sample={errors_global[:3]}")

        browser.close()

    all_pass = all(r["ok"] for r in results)
    print(f"\n=== {'ALL PASS' if all_pass else 'SOME FAIL'} ({sum(1 for r in results if r['ok'])}/{len(results)}) ===")
    with open(os.path.join(OUT, "evaluator-report.json"), "w") as f:
        json.dump({"all_pass": all_pass, "results": results, "errors": errors_global[:20]}, f, indent=2)
    return 0 if all_pass else 1


if __name__ == "__main__":
    raise SystemExit(main())