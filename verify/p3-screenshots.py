"""P3 visual audit — capture each Sophos view for the critic.

Usage: python verify/p3-screenshots.py
Captures before/after evidence into verify/p3-shots/.
"""
from playwright.sync_api import sync_playwright
import os
import time

URL = "http://localhost:1420/"
OUT = os.path.join(os.path.dirname(__file__), "p3-shots")
os.makedirs(OUT, exist_ok=True)

VIEWS = ["chat", "sessions", "agents", "inbox", "settings"]
NAV = {"chat": "Chat", "sessions": "Sessions", "agents": "Agents", "inbox": "Inbox", "settings": "Settings"}

errors = []
console_lines = []


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--disable-gpu", "--no-sandbox"])
        ctx = browser.new_context(viewport={"width": 1680, "height": 980})
        page = ctx.new_page()
        page.on("console", lambda msg: console_lines.append(f"[{msg.type}] {msg.text}"))
        page.on("pageerror", lambda err: errors.append(f"PAGEERROR: {err}"))
        page.goto(URL, wait_until="networkidle", timeout=20000)
        time.sleep(2)

        # Chat (default view)
        page.screenshot(path=os.path.join(OUT, "chat.png"))
        time.sleep(0.5)

        # Navigate to each other view
        for vid in VIEWS[1:]:
            try:
                page.click(f"text={NAV[vid]}", timeout=4000)
                time.sleep(1.5)
                page.screenshot(path=os.path.join(OUT, f"{vid}.png"))
            except Exception as e:
                errors.append(f"could not navigate to {vid}: {e}")

        # Open the command palette (Ctrl+K) for a shot
        try:
            page.keyboard.press("Control+k")
            time.sleep(1)
            page.screenshot(path=os.path.join(OUT, "command-palette.png"))
            page.keyboard.press("Escape")
        except Exception as e:
            errors.append(f"palette: {e}")

        browser.close()

    # Write a probe report
    report = os.path.join(OUT, "probe-report.txt")
    with open(report, "w") as f:
        f.write("P3 screenshot probe report\n==========================\n\n")
        f.write(f"Console lines ({len(console_lines)}):\n")
        for l in console_lines[:60]:
            f.write(f"  {l}\n")
        f.write(f"\nPage errors ({len(errors)}):\n")
        for e in errors[:30]:
            f.write(f"  {e}\n")
    print(f"shots -> {OUT}")
    print(f"console lines: {len(console_lines)}, page errors: {len(errors)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
