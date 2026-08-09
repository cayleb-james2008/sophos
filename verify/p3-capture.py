"""Capture all 5 Sophos views + command palette into a given output dir.

Usage: python verify/p3-capture.py <outdir>
"""
from playwright.sync_api import sync_playwright
import os
import sys
import time

URL = "http://localhost:1420/"
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "p3-shots")
os.makedirs(OUT, exist_ok=True)

VIEWS = ["chat", "sessions", "agents", "inbox", "settings"]
NAV = {"chat": "Chat", "sessions": "Sessions", "agents": "Agents", "inbox": "Inbox", "settings": "Settings"}


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--disable-gpu", "--no-sandbox"])
        ctx = browser.new_context(viewport={"width": 1680, "height": 980})
        page = ctx.new_page()
        page.goto(URL, wait_until="networkidle", timeout=20000)
        time.sleep(2)
        page.screenshot(path=os.path.join(OUT, "chat.png"))
        for vid in VIEWS[1:]:
            page.click(f"text={NAV[vid]}", timeout=4000)
            time.sleep(1.5)
            page.screenshot(path=os.path.join(OUT, f"{vid}.png"))
        page.keyboard.press("Control+k")
        time.sleep(1)
        page.screenshot(path=os.path.join(OUT, "command-palette.png"))
        page.keyboard.press("Escape")
        browser.close()
    print(f"captured -> {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
