"""Critic probe — drives the Agents view through a real Chromium to verify
that the rendered DOM matches the worker's claims and capture any console
errors / unhandled rejections.

Usage: python critic-probe.py
"""

from playwright.sync_api import sync_playwright
import json
import sys
import time

URL = "http://localhost:1421/"
OUT = "C:/Users/Cayleb/.traycer/worktrees/local__prime-agent-windows__f2eb521c4d/piece-agents/verify/critic-probe.png"

errors = []
warnings = []
console_lines = []


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--disable-gpu", "--no-sandbox"])
        ctx = browser.new_context(viewport={"width": 1680, "height": 980})
        page = ctx.new_page()
        page.on("console", lambda msg: console_lines.append(f"[{msg.type}] {msg.text}"))
        page.on("pageerror", lambda err: errors.append(f"PAGEERROR: {err}"))
        page.on("requestfailed", lambda req: warnings.append(f"REQFAIL: {req.url} ({req.failure})"))
        page.goto(URL, wait_until="networkidle", timeout=15000)
        time.sleep(1.5)

        # Click the Agents nav item
        try:
            page.click("text=Agents", timeout=4000)
        except Exception as e:
            errors.append(f"could not click Agents nav: {e}")
        time.sleep(1.5)

        # Probe the DOM — collect everything we can
        probe = page.evaluate(
            r"""
() => {
  const out = {};
  // Header
  out.title = document.querySelector(".ag-header h1")?.textContent ?? null;
  out.eyebrow = document.querySelector(".ag-eyebrow")?.textContent?.trim() ?? null;
  out.subtitle = document.querySelector(".ag-header p")?.textContent ?? null;

  // Telemetry
  const tele = document.querySelector(".ag-telemetry");
  out.telemetryText = tele ? tele.textContent : null;

  // Model bar
  out.modelLabel = document.querySelector(".ag-modelbar__label")?.textContent ?? null;
  out.modelValue = document.querySelector(".ag-modelbar__value")?.textContent ?? null;
  out.modelProvider = document.querySelector(".ag-modelbar__provider")?.textContent ?? null;

  // Rail
  out.railHead = document.querySelector(".ag-railhead")?.textContent?.trim() ?? null;
  out.empty = document.querySelector(".ag-emptyrail b")?.textContent ?? null;
  out.emptyDesc = document.querySelector(".ag-emptyrail p")?.textContent ?? null;

  // Detail
  out.detailStandby = document.querySelector(".ag-detail__standby h2, .ag-detail__standby b")?.textContent ?? null;
  out.threadWelcome = document.querySelector(".ag-thread__welcome h2, .ag-thread__welcome b")?.textContent ?? null;
  out.composerPlaceholder = document.querySelector(".ag-composer__area")?.getAttribute("placeholder") ?? null;

  // Footer
  out.footer = document.querySelector(".ag-footer")?.textContent?.trim() ?? null;

  // Legend (status dots)
  out.legend = document.querySelector(".ag-railfoot")?.textContent?.trim() ?? null;

  // Check for old stub text — should NOT be present anywhere
  out.hasOldStub = document.body.textContent.includes("Module pending");

  // Sidebar Inbox badge
  const navBtns = [...document.querySelectorAll("aside nav button")];
  const inboxBtn = navBtns.find((b) => b.textContent.includes("Inbox"));
  out.inboxBadge = inboxBtn ? inboxBtn.querySelector("[class*=badge], [class*=Badge]")?.textContent ?? null : null;

  // Active view
  out.activeNavLabel = navBtns.find((b) => b.getAttribute("aria-current") === "page")?.textContent?.trim() ?? null;

  return out;
}
"""
        )

        page.screenshot(path=OUT, full_page=False)

        # Now try clicking the Inbox nav to confirm the Agents view unmounts cleanly
        try:
            page.click("text=Inbox", timeout=4000)
            time.sleep(0.5)
            page.click("text=Agents", timeout=4000)
            time.sleep(0.8)
        except Exception as e:
            warnings.append(f"nav roundtrip: {e}")

        # Test: simulate an agent_message event by injecting one into the IPC event stream.
        # Since MockIpcClient is the browser fallback, we can't easily push an event. Skip.

        # Final snapshot
        after = page.evaluate(
            r"""
() => {
  return {
    agentCount: document.querySelectorAll(".ag-agent:not(.ag-agent--skeleton)").length,
    groupHeads: [...document.querySelectorAll(".ag-grouphead span:first-child")].map(e => e.textContent),
    legendItems: [...document.querySelectorAll(".ag-railfoot span")].map(e => e.textContent.trim()),
  };
}
"""
        )

        browser.close()

        print(json.dumps({
            "probe": probe,
            "after": after,
            "errors": errors,
            "warnings": warnings,
            "console_count": len(console_lines),
            "console_errors": [l for l in console_lines if "[error]" in l.lower()],
            "console_warnings": [l for l in console_lines if "[warning]" in l.lower()],
            "console_sample": console_lines[:5],
        }, indent=2))

        if errors:
            return 2
        return 0


sys.exit(main())
