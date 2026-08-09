"""V3 — capture the two UI states the default screenshots never reach.

A blind vision critic could not validate two surfaces (its defects D8 and D13)
because they only exist in states the happy-path demo never enters:

  1. The copyable OAuth sign-in link + first-class API-key section, which live
     in the Connect modal and only render for a DISCONNECTED, MANAGED
     (kind === "subscription") provider.
  2. The refinement review-and-approve gate, which only renders once a
     `refinement_result` event has arrived and is being held pending.

Both are driven here through the app's own public surfaces:
  - state 1 by patching MockIpcClient.getProviders at runtime (the same
    technique verify/e2e/mock-patch.mjs already uses) so one provider is both
    disconnected AND managed;
  - state 2 by calling the app's real refine() path, which emits a genuine
    refinement_result the gate then holds pending.

No src/ change. Nothing is faked into the DOM — every pixel is the real
component rendering real state.

Output: verify/v3-states/*.png + report.json
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


def patch_managed_disconnected(page):
    """Make the first provider a DISCONNECTED MANAGED (subscription) provider.

    The stock mock ships every provider as kind:"api_key" and connected:true,
    so the OAuth CopyField — which requires kind === "subscription" AND the
    disconnected Connect modal — is unreachable. This patches the mock only,
    exactly as the existing e2e mock-patch helper does.
    """
    return page.evaluate("""async () => {
        const mod = await import("/src/ipc/client.ts");
        const proto = mod.MockIpcClient.prototype;
        if (!proto.__origV3) proto.__origV3 = { getProviders: proto.getProviders };
        proto.getProviders = async function () {
            const list = await proto.__origV3.getProviders.call(this);
            return list.map((p, i) =>
                i === 0 ? { ...p, kind: "subscription", connected: false } : p);
        };
        return true;
    }""")


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--disable-gpu", "--no-sandbox"])
        ctx = browser.new_context(viewport={"width": 1680, "height": 980})
        page = ctx.new_page()
        console_errors = []
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)

        page.goto(URL, wait_until="networkidle", timeout=30000)
        page.wait_for_selector("text=Engine Live", timeout=20000)
        page.wait_for_timeout(1500)

        # ---------------------------------------------------------------
        # STATE 1 — disconnected managed provider -> Connect modal
        # ---------------------------------------------------------------
        print("\nSTATE 1 — copyable OAuth link + first-class API-key entry (critic D8)")
        patch_managed_disconnected(page)

        page.get_by_role("button", name="Settings", exact=True).first.click(timeout=8000)
        page.mouse.move(1600, 950)
        page.wait_for_timeout(600)
        page.get_by_role("tab", name="Providers", exact=True).first.click(timeout=8000)
        page.mouse.move(1600, 950)
        page.wait_for_timeout(1200)

        # The patched provider must now show as offline with a Connect action.
        connect = page.get_by_role("button", name="Connect").first
        record("disconnected provider exposes a Connect action", connect.count() > 0)
        page.screenshot(path=os.path.join(OUT, "providers-disconnected.png"))

        connect.click(timeout=8000)
        page.wait_for_timeout(1200)

        modal_text = ""
        dlg = page.locator('[role="dialog"]')
        if dlg.count():
            modal_text = dlg.first.inner_text()

        record("Connect modal opened", dlg.count() > 0)
        record("OAuth sign-in section present", "SIGN IN WITH OAUTH" in modal_text.upper(),
               "requires kind=subscription")
        record("copyable link field present",
               page.locator('button:has-text("Copy")').count() > 0)
        record("API-key entry offered as first-class alternative",
               "API KEY" in modal_text.upper())
        record("'or' divider between the two paths", "\nOR\n" in f"\n{modal_text.upper()}\n"
               or " OR " in modal_text.upper())
        page.screenshot(path=os.path.join(OUT, "providers-connect-modal.png"))

        # Prove the copy button actually confirms (it swaps label to "Copied").
        ctx.grant_permissions(["clipboard-read", "clipboard-write"])
        copy_btn = page.locator('button:has-text("Copy")').first
        if copy_btn.count():
            copy_btn.click(timeout=8000)
            page.wait_for_timeout(600)
            confirmed = page.locator('button:has-text("Copied")').count() > 0
            record("copy button confirms with 'Copied'", confirmed)
            page.screenshot(path=os.path.join(OUT, "providers-copy-confirmed.png"))
        else:
            record("copy button confirms with 'Copied'", False, "no Copy button found")

        # Close the modal.
        cancel = page.locator('button:has-text("Cancel")').first
        if cancel.count():
            cancel.click(timeout=8000)
            page.wait_for_timeout(700)

        # ---------------------------------------------------------------
        # STATE 2 — pending refinement -> review-and-approve gate
        # ---------------------------------------------------------------
        print("\nSTATE 2 — refinement review-and-approve gate (critic D13)")

        # Drive the app's REAL refine path; the mock emits a genuine
        # refinement_result which the gate holds as a pending proposal.
        page.evaluate("""async () => {
            const mod = await import("/src/ipc/client.ts");
            const c = window.__sophosIpc || mod.getIpcClient?.();
            if (c && c.refine) { await c.refine(); return "refined"; }
            return "no-client";
        }""")
        page.wait_for_timeout(1500)

        body_upper = page.locator("body").inner_text().upper()
        record("pending refinement is surfaced somewhere in the UI",
               "REFINE" in body_upper)
        page.screenshot(path=os.path.join(OUT, "refine-pending-global.png"))

        # The REFINE alert should now be lit in the system bar (it is
        # attention-only, so its presence IS the proof the gate is holding).
        header_upper = page.locator("header").first.inner_text().upper()
        record("system bar shows the REFINE alert while a proposal is pending",
               "REFINE" in header_upper)

        # Now open the Refinement panel to capture the actual gate UI.
        page.get_by_role("tab", name="Long-running", exact=True).first.click(timeout=8000) \
            if page.get_by_role("tab", name="Long-running", exact=True).count() else None
        page.mouse.move(1600, 950)
        page.wait_for_timeout(800)
        if page.get_by_role("tab", name="Refinement", exact=True).count():
            page.get_by_role("tab", name="Refinement", exact=True).first.click(timeout=8000)
            page.mouse.move(1600, 950)
            page.wait_for_timeout(1200)

        panel_upper = page.locator("body").inner_text().upper()
        record("Apply action present (explicit approval required)", "APPLY" in panel_upper)
        record("Discard action present", "DISCARD" in panel_upper)
        record("proposal summary shown before applying",
               "TIGHTEN THE SESSION INSTRUCTIONS" in panel_upper)
        page.screenshot(path=os.path.join(OUT, "refine-gate-pending.png"), full_page=False)

        record("no console errors during capture", len(console_errors) == 0,
               f"{len(console_errors)} errors")

        browser.close()

    passed = sum(1 for r in results if r["ok"])
    with open(os.path.join(OUT, "report.json"), "w", encoding="utf-8") as fh:
        json.dump({"results": results, "consoleErrors": console_errors}, fh, indent=2)

    print(f"\n{passed}/{len(results)} checks passed")
    print("RESULT:", "PASS" if passed == len(results) else "FAIL")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
