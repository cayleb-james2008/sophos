"""P10 verification probe — real-default maxima, apply, reload persistence, reset.

Drives the live dev server (http://localhost:1420) headlessly with Playwright,
mirroring the critic's harness. Verifies:
  1. D3 — every model defaults to the REAL provider max (deepseek 1,000,000 ctx /
     65,536 out; MiniMax 524,288 ctx / 128,000 out), not an invented number.
  2. Apply changes a model's runtime config and the row reflects it.
  3. D2 — a FULL page reload (not a tab remount) keeps the persisted values.
  4. Reset to max restores the ceiling (and survives a reload).
  5. 0 console / page errors.
"""
import json, sys, time
from playwright.sync_api import sync_playwright

URL = "http://localhost:1420/"
BASE = "C:/Users/Cayleb/.traycer/worktrees/local__prime-agent-windows__f2eb521c4d/piece-context/verify"
OUT = f"{BASE}/p10-verify.png"
errors = []
console_lines = []


def js_click(page, selector, match_text=None):
    if selector == "tab":
        page.evaluate(
            "() => { const t=[...document.querySelectorAll('[role=tab]')].find(b=>b.textContent.trim()==='Providers'); t && t.click(); }"
        )
    elif selector == "text":
        page.evaluate(
            "(txt) => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes(txt)); b && b.click(); }",
            match_text,
        )
    time.sleep(1.0)


def model_rows(page):
    return page.evaluate(
        r"""
() => {
  const btns = [...document.querySelectorAll("button")];
  return btns
    .filter(b => /·/.test(b.textContent||"") && /ctx|out/i.test(b.textContent||""))
    .map(b => b.textContent.trim().replace(/\s+/g," "));
}
"""
    )


def open_providers(page):
    js_click(page, "text", "Settings")
    js_click(page, "tab")


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--disable-gpu", "--no-sandbox"])
        ctx = browser.new_context(viewport={"width": 1680, "height": 1000})
        page = ctx.new_page()
        page.on("console", lambda msg: console_lines.append(f"[{msg.type}] {msg.text}"))
        page.on("pageerror", lambda err: errors.append(f"PAGEERROR: {err}"))

        # Clean slate — wipe persisted mock overrides so defaults are pure.
        page.goto(URL, wait_until="domcontentloaded", timeout=20000)
        page.evaluate("() => { try { localStorage.clear(); } catch(e){} }")
        time.sleep(2)

        open_providers(page)
        rows_before = model_rows(page)
        page.screenshot(path=OUT, full_page=False)

        # Expand DeepSeek, inspect adjuster.
        js_click(page, "text", "DeepSeek V4 Flash 0731")
        time.sleep(0.8)
        adjuster = page.evaluate(
            r"""
() => {
  const ranges=[...document.querySelectorAll("input[type=range]")];
  const nums=[...document.querySelectorAll("input[type=number]")];
  return {
    ranges: ranges.length, numbers: nums.length,
    rangeVals: ranges.map(r=>r.value), numVals: nums.map(n=>n.value),
    labels:[...document.querySelectorAll("input")].map(i=>i.getAttribute("aria-label")).filter(Boolean)
  };
}
"""
        )
        page.screenshot(path=f"{BASE}/p10-adjuster-r2.png", full_page=False)

        # If the adjuster didn't render, retry the click (row may not have expanded).
        if adjuster.get("numbers", 0) < 2:
            js_click(page, "text", "DeepSeek V4 Flash 0731")
            time.sleep(0.8)
            adjuster = page.evaluate(
                r"""
() => {
  const ranges=[...document.querySelectorAll("input[type=range]")];
  const nums=[...document.querySelectorAll("input[type=number]")];
  return {
    ranges: ranges.length, numbers: nums.length,
    rangeVals: ranges.map(r=>r.value), numVals: nums.map(n=>n.value),
    labels:[...document.querySelectorAll("input")].map(i=>i.getAttribute("aria-label")).filter(Boolean)
  };
}
"""
            )
            page.screenshot(path=f"{BASE}/p10-adjuster-r2b.png", full_page=False)

        # Change values + Apply.
        if adjuster.get("numbers", 0) >= 2:
            page.locator("input[type=number]").nth(0).fill("128000")
            page.locator("input[type=number]").nth(1).fill("32768")
            time.sleep(0.3)
            js_click(page, "text", "Apply to model")
        rows_after_apply = model_rows(page)
        page.screenshot(path=f"{BASE}/p10-applied.png", full_page=False)

        # FULL PAGE RELOAD — persistence must survive.
        page.reload(wait_until="domcontentloaded", timeout=20000)
        time.sleep(2)
        open_providers(page)
        rows_after_reload = model_rows(page)
        page.screenshot(path=f"{BASE}/p10-after-reload.png", full_page=False)

        # Reset to max.
        js_click(page, "text", "DeepSeek V4 Flash 0731")
        js_click(page, "text", "Reset to max")
        rows_after_reset = model_rows(page)

        # Reset must also survive a reload.
        page.reload(wait_until="domcontentloaded", timeout=20000)
        time.sleep(2)
        open_providers(page)
        rows_after_reset_reload = model_rows(page)

        browser.close()
        result = {
            "rows_before": rows_before,
            "adjuster": adjuster,
            "rows_after_apply": rows_after_apply,
            "rows_after_full_reload": rows_after_reload,
            "rows_after_reset": rows_after_reset,
            "rows_after_reset_reload": rows_after_reset_reload,
            "errors": errors,
            "console_errors": [l for l in console_lines if "[error]" in l.lower()],
            "console_count": len(console_lines),
        }
        print(json.dumps(result, indent=2))
        return 2 if errors else 0


sys.exit(main())
