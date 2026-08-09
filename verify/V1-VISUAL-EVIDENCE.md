# V1 — Full Frontend Visual Testing vs primeintellect.ai

**Date:** 2026-08-09
**Run by:** gauntlet orchestrator (own verification — not a critic's claim)
**Subject:** integrated `master` after merging I1 (UX improvements) + I2 (agentic reliability)

## Result: **PASS** — 9/9 views match the Prime Intellect design system, 0 blockers

---

## 1. Live reference comparison

`verify/v1-reference-compare.py` re-scrapes the **live** https://www.primeintellect.ai/
(not the archived copy) and diffs its authoritative `:root` design tokens against what
Sophos actually renders.

| Token | primeintellect.ai (live) | Sophos (rendered) | Match |
|---|---|---|---|
| `--background` | `rgb(14, 14, 14)` (`#0e0e0e`) | `rgb(14, 14, 14)` | ✅ |
| `--foreground` | `rgb(244, 244, 244)` (`#f4f4f4`) | `rgb(244, 244, 244)` | ✅ |
| `--border` | `rgb(42, 42, 42)` (`#2a2a2a`) | `rgb(42, 42, 42)` | ✅ |
| `--radius` | `0px` | 0 radius violations across all views | ✅ |
| `--chart-1` (accent) | `#85ed75` | terminal green on 181 elements | ✅ |
| `--card` | `#151515` | `tokens.color.surface` = `#151515` | ✅ |

### Why we compare tokens, not painted pixels

A first pass compared Sophos's `<body>` against the live site's `<body>` and reported
three "mismatches". All three were **comparison artifacts, not design drift**:

| Naive comparison | Live value | Why it is not the design system |
|---|---|---|
| body background | `rgba(0, 0, 0, 0)` | The marketing site leaves `<body>` transparent and paints `#0e0e0e` on a wrapper element. |
| body foreground | `rgb(255, 255, 255)` | A marketing hero heading overrides to pure white; the token is `#f4f4f4`. |
| dominant border | `rgb(32, 32, 32)` | The most-repeated painted border belongs to one marketing component; the token is `#2a2a2a`. |

The shared design language is the `:root` custom-property set — that is what a desktop
app ports, and that is what matches exactly. The script documents this explicitly so the
reasoning is auditable rather than hand-waved.

---

## 2. Per-view computed-style sweep

`verify/v1-visual-match.py` walks **every** view — including the surfaces added by I1/I2
this run — and asserts the DNA on the real rendered DOM.

| View | body bg | body fg | dominant border | accent elements | radius violations |
|---|---|---|---|---|---|
| chat | `rgb(14,14,14)` | `rgb(244,244,244)` | `rgb(42,42,42)` | 11 | 0 |
| sessions | `rgb(14,14,14)` | `rgb(244,244,244)` | `rgb(42,42,42)` | 53 | 0 |
| agents | `rgb(14,14,14)` | `rgb(244,244,244)` | `rgb(42,42,42)` | 37 | 0 |
| inbox | `rgb(14,14,14)` | `rgb(244,244,244)` | `rgb(42,42,42)` | 11 | 0 |
| settings:General | `rgb(14,14,14)` | `rgb(244,244,244)` | `rgb(42,42,42)` | 9 | 0 |
| **settings:Providers** (I1 U3) | `rgb(14,14,14)` | `rgb(244,244,244)` | `rgb(42,42,42)` | 21 | 0 |
| settings:Skills | `rgb(14,14,14)` | `rgb(244,244,244)` | `rgb(42,42,42)` | 9 | 0 |
| **settings:Advanced** (I1 U4) | `rgb(14,14,14)` | `rgb(244,244,244)` | `rgb(42,42,42)` | 20 | 0 |
| **settings:Long-running** (I2 A1–A4) | `rgb(14,14,14)` | `rgb(244,244,244)` | `rgb(42,42,42)` | 10 | 0 |

**Drift checks across all 9 views:** 0 copper (`#C98A5B`/`#D6A077`), 0 banned fonts
(Space Grotesk / JetBrains Mono), 0 glow shadows (blur > 2px), 0 illegal border-radius
(only `0px`, `50%`, `9999px` circular dots), 0 console errors, 0 navigation warnings.

**Fonts rendered:** `Geist`, `Geist Mono` (plus UA defaults `Arial` / `Times New Roman`
on unstyled UA elements, which carry no visible text).

The first sweep silently skipped two views (bad selectors) and still reported PASS — a
pass on unvisited views is not a pass. Selectors were fixed to drive the nav by
accessible role/name and dismiss the intercepting tooltip; the table above is from the
corrected run where all 9 views were genuinely visited and swept.

---

## 3. Functional regression gate

| Gate | Result |
|---|---|
| `npm run build` (integrated master) | ✅ green, 0 TS errors, 5.29s |
| `node verify/e2e-browser.mjs` (integrated master) | ✅ **35/35 passed, 0 failed, 0 console errors** |
| `git diff <baseline> -- src/ipc/contract.ts` | ✅ empty — contract frozen |
| `git diff <baseline> -- vite.config.ts` | ✅ empty — no dev-server guard weakened |

---

## 4. Artifacts

- `verify/v1-visual/report.json` — full per-view computed-style sweep
- `verify/v1-visual/reference-compare.json` — live-site token diff
- `verify/v1-visual/shots/` — screenshot per view (9)
- `verify/v1-visual/reference-primeintellect.png` — live reference capture
- `verify/v1-visual-match.py`, `verify/v1-reference-compare.py` — repeatable harnesses

## 5. Hygiene

After every run: 0 vite processes, 0 headless Chrome, port 1420 closed (verified via
`Get-CimInstance Win32_Process` + a socket check). The operator's own long-running Chrome
windows were left untouched.
