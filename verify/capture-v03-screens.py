"""Capture V0.2 feature screenshots for the README.

Captures from the already-running Vite dev server at http://127.0.0.1:1420/:
  1. Onboarding wizard (light theme)          -> assets/sophos-onboarding.png
  2. Light theme chat view                     -> assets/sophos-light-theme.png
  3. Slash autocomplete dropdown               -> assets/sophos-slash-autocomplete.png
  4. MCP servers panel (Settings -> Advanced)  -> assets/sophos-mcp-servers.png
  5. Command palette filtered to Prompt Templates -> assets/sophos-prompt-templates.png

The app uses a Mock IPC client in browser mode, so all data is mocked. No
src/ change is made — every pixel is the real component rendering real state.
"""
import json
import os
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path("C:/Users/Cayleb/.traycer/worktrees/cayleb-james2008__sophos/gauntlet-theme")
ASSETS = ROOT / "assets"
ASSETS.mkdir(exist_ok=True)
URL = "http://127.0.0.1:1420/"

VIEWPORT = {"width": 1440, "height": 900}

results = []


def record(name, ok, detail=""):
    results.append({"check": name, "ok": bool(ok), "detail": detail})
    print(f"  {'PASS' if ok else 'FAIL'}  {name}" + (f" — {detail}" if detail else ""))


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--disable-gpu", "--no-sandbox"])
        ctx = browser.new_context(viewport=VIEWPORT)
        page = ctx.new_page()
        console_errors = []
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: console_errors.append(f"pageerror: {e}"))

        # ------------------------------------------------------------------
        # 1. Onboarding wizard (light theme)
        # ------------------------------------------------------------------
        print("\n[1] Onboarding wizard (light theme)")
        page.goto(URL, wait_until="networkidle", timeout=30000)
        page.evaluate("""
        () => {
            localStorage.clear();
            localStorage.setItem('prime-agent.settings.v1', JSON.stringify({ theme: 'light' }));
        }
        """)
        page.reload(wait_until="networkidle", timeout=30000)
        page.wait_for_timeout(1500)

        theme = page.evaluate("() => document.documentElement.getAttribute('data-theme')")
        record("light theme applied", theme == "light", f"data-theme={theme}")

        onboarding = page.locator(".pa-onboarding")
        onboarding.wait_for(state="visible", timeout=10000)
        record("onboarding wizard visible", onboarding.count() > 0)
        page.screenshot(path=str(ASSETS / "sophos-onboarding.png"))
        record("saved sophos-onboarding.png", (ASSETS / "sophos-onboarding.png").stat().st_size > 0)

        # ------------------------------------------------------------------
        # 2. Light theme chat view (dismiss onboarding first)
        # ------------------------------------------------------------------
        print("\n[2] Light theme chat view")
        # Dismiss onboarding via Escape (the wizard binds Esc to dismiss).
        page.keyboard.press("Escape")
        page.wait_for_timeout(600)
        record("onboarding dismissed", onboarding.count() == 0 or not onboarding.is_visible())
        # Ensure we're on the chat view.
        page.wait_for_selector('textarea[aria-label="Message input"]', timeout=10000)
        page.wait_for_timeout(800)
        page.screenshot(path=str(ASSETS / "sophos-light-theme.png"))
        record("saved sophos-light-theme.png", (ASSETS / "sophos-light-theme.png").stat().st_size > 0)

        # ------------------------------------------------------------------
        # 3. Slash autocomplete
        # ------------------------------------------------------------------
        print("\n[3] Slash autocomplete")
        ta = page.locator('textarea[aria-label="Message input"]')
        ta.click()
        ta.press("/")
        page.wait_for_timeout(500)
        slash = page.locator(".slash-autocomplete, [class*='slash']")
        record("slash autocomplete dropdown visible", slash.count() > 0)
        page.screenshot(path=str(ASSETS / "sophos-slash-autocomplete.png"))
        record("saved sophos-slash-autocomplete.png", (ASSETS / "sophos-slash-autocomplete.png").stat().st_size > 0)

        # Clear the composer so it doesn't leak into later captures.
        ta.press("Escape")
        page.wait_for_timeout(300)

        # ------------------------------------------------------------------
        # 4. MCP servers panel (Settings -> Advanced)
        # ------------------------------------------------------------------
        print("\n[4] MCP servers panel")
        page.get_by_role("button", name="Settings", exact=True).first.click(timeout=8000)
        page.wait_for_timeout(800)
        # The MCP servers panel lives in the Advanced tab.
        page.get_by_role("tab", name="Advanced", exact=True).first.click(timeout=8000)
        page.wait_for_timeout(1200)

        mcp_card = page.locator("text=MCP servers").first
        record("MCP servers panel present", mcp_card.count() > 0)
        # Scroll the MCP servers card into view and capture it as an element.
        mcp_card.scroll_into_view_if_needed()
        page.wait_for_timeout(500)
        card = mcp_card.locator("xpath=ancestor::div[contains(@class,'card')][1]")
        if card.count():
            card.screenshot(path=str(ASSETS / "sophos-mcp-servers.png"))
        else:
            page.screenshot(path=str(ASSETS / "sophos-mcp-servers.png"))
        record("saved sophos-mcp-servers.png", (ASSETS / "sophos-mcp-servers.png").stat().st_size > 0)

        # ------------------------------------------------------------------
        # 5. Command palette filtered to Prompt Templates
        # ------------------------------------------------------------------
        print("\n[5] Command palette -> Prompt Templates")
        page.keyboard.press("Control+k")
        page.wait_for_timeout(600)
        palette = page.locator('[role="dialog"][aria-label="Command palette"]')
        record("command palette opened", palette.count() > 0)
        palette_input = page.locator(".palette__input")
        palette_input.wait_for(state="visible", timeout=5000)
        palette_input.fill("template")
        page.wait_for_timeout(500)
        body_upper = page.locator("body").inner_text().upper()
        record("Prompt Templates group filtered", "PROMPT TEMPLATES" in body_upper)
        page.screenshot(path=str(ASSETS / "sophos-prompt-templates.png"))
        record("saved sophos-prompt-templates.png", (ASSETS / "sophos-prompt-templates.png").stat().st_size > 0)

        record("no console errors during capture", len(console_errors) == 0,
               f"{len(console_errors)} errors")

        browser.close()

    passed = sum(1 for r in results if r["ok"])
    with open(ROOT / "verify" / "capture-v03-report.json", "w", encoding="utf-8") as fh:
        json.dump({"results": results, "consoleErrors": console_errors}, fh, indent=2)

    print(f"\n{passed}/{len(results)} checks passed")
    print("RESULT:", "PASS" if passed == len(results) else "FAIL")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
