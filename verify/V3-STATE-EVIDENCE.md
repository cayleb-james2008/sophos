# V3 — Capturing the two unproven UI states

**Date:** 2026-08-09
**Run by:** orchestrator (own verification)
**Purpose:** close the vision critic's **evidence gap** — defects D8 and D13.

The critic could not validate two surfaces because they only exist in states the
happy-path demo never enters, so the default screenshots never reached them:

| Critic defect | Surface | Why it was invisible |
|---|---|---|
| **D8** | Copyable OAuth sign-in link + first-class API-key entry | Lives in the **Connect modal**, which only opens for a **disconnected** provider, and the OAuth block only renders for a **managed** (`kind === "subscription"`) provider. |
| **D13** | Refinement review-and-approve gate | Only renders once a `refinement_result` event has arrived and is being **held pending**. |

Both are now captured from **real component renders of real state** — nothing was
faked into the DOM, and no `src/` file was changed to make them appear.

---

## Result: **PASS** — 13/13 capture checks + 10/10 behaviour checks

---

## 1. State capture — `verify/v3-capture-states.py` (13/13)

Drives the states through the app's own surfaces: the provider state by patching
`MockIpcClient.getProviders` at runtime (the same technique the existing
`verify/e2e/mock-patch.mjs` already uses), and the refinement state by calling
the app's **real** `refine()` path, which emits a genuine `refinement_result`.

### D8 — copyable OAuth link + first-class API-key entry

| Check | Result |
|---|---|
| Disconnected provider exposes a Connect action | PASS |
| Connect modal opens | PASS |
| "Sign in with OAuth" section present | PASS |
| Copyable link field present | PASS |
| API-key entry offered as a first-class alternative | PASS |
| "or" divider between the two paths | PASS |
| Copy button confirms with "Copied" | PASS |

Screenshots: `providers-disconnected.png`, `providers-connect-modal.png`,
`providers-copy-confirmed.png`.

### D13 — refinement review-and-approve gate

| Check | Result |
|---|---|
| Pending refinement surfaced in the UI | PASS |
| System bar lights the REFINE alert while pending | PASS |
| Apply action present (explicit approval required) | PASS |
| Discard action present | PASS |
| Proposal summary shown **before** applying | PASS |
| No console errors during capture | PASS (0) |

Screenshots: `refine-pending-global.png`, `refine-gate-pending.png`.

---

## 2. Behaviour proof — `verify/v3-gate-behaviour.py` (10/10)

A screenshot proves a surface **exists**; it does not prove it is
**load-bearing**. This asserts the security property the gate was built for
(research D37/D38/F17 — *"a self-editing loop with no human gate is how a system
drifts silently"*):

| Property | Result |
|---|---|
| Auto-apply is **OFF by default** (`localStorage` key absent) | PASS |
| No refinement pending at rest | PASS |
| An arriving refinement is **held pending**, not auto-applied | PASS |
| The proposal is shown for review **before** any apply | PASS |
| Pending state **survives navigation** — cannot be lost or bypassed by moving around the app | PASS |
| **Discard** clears it **without** applying | PASS |
| **Apply** resolves it only by explicit user action | PASS |
| No console errors | PASS (0) |

Screenshots: `refine-gate-review.png`, `refine-gate-applied.png`.
Machine-readable: `gate-behaviour.json`.

**This is the meaningful result.** The gate is not decorative: the self-editing
loop genuinely cannot complete without a human decision.

---

## 3. Honest finding — RESOLVED (follow-up completed 2026-08-09)

**The finding, as originally recorded:** every provider in `MockIpcClient`
shipped as `kind: "api_key"` (4 of 4) and `connected: true`, with no
`kind: "subscription"` provider anywhere. Because the OAuth CopyField renders
only for a managed provider in the disconnected Connect modal, that surface was
**unreachable in browser-demo mode by any navigation path** — precisely why the
critic never saw it and reported it absent. The capture above proved the
component correct *when given the state*, but not *reachable*.

**Now fixed.** `MockIpcClient.getProviders()` ships a fifth provider —
`prime-intellect`, `kind: "subscription"`, deliberately **disconnected** — so the
OAuth path is reachable by ordinary clicking. Two supporting changes:

- **Provider order is preserved.** `ollama-cloud` stays at index 0 because the
  existing e2e login-flow test patches the first entry; the new provider is
  appended, not inserted.
- **`login`/`logout` are no longer no-ops.** They were empty methods, so the
  demo UI could claim a state change that never happened. They now flip real
  session state, making the Connect → modal → connected round-trip honest.

**Verified reachable with NO mock patching** (pure user navigation):
Providers tab → "Prime Intellect" card shows a **Managed** badge → **Connect** →
modal shows the OAuth sign-in section, the copyable link, the **API key**
alternative, and the copy control confirms with **Copied**. 0 console errors.

**Now covered by the standing suite.** New test
`[Flows] Managed provider exposes a copyable OAuth link + API-key alternative`
in `verify/e2e/flows.test.mjs` asserts the whole path on the **default** mock
(no patch, by design) — managed provider present + badge, Connect opens the
modal, OAuth section present, copyable link present, API-key alternative
offered, and the copy control confirms. Stable **3/3** in isolation.

This converts the surface from *"proven under a test patch"* to *"proven on the
default path and regression-guarded"*. Suite: **35 → 36 tests, all passing.**

---

## 4. Artifacts

- `verify/v3-capture-states.py` — repeatable state-capture harness
- `verify/v3-gate-behaviour.py` — repeatable gate-behaviour proof
- `verify/v3-states/*.png` — 7 screenshots of the two previously-unseen states
- `verify/v3-states/report.json`, `verify/v3-states/gate-behaviour.json`

## 5. Hygiene

Dev server and all headless Chrome spawned by these runs were terminated and
verified clear; the operator's own Chrome windows were left untouched.
