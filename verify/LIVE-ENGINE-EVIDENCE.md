# Live-engine verification — do the safety controls actually fire?

**Date:** 2026-08-09
**Run by:** orchestrator (own verification)
**Question:** everything so far was proven in **browser-demo mode** against
`MockIpcClient`. Do the **approve-gate** and the **spend/iteration
circuit-breaker** work against the **real daemon**?

## Result: **6/6 asserted checks PASS** against the real daemon + real bridge

But read §4 — one part of the claim is proven and one part is bounded.

---

## 1. Getting to a live engine at all (the hard part)

The daemon would not start. Root cause, from its own log:

```
daemon command "create" failed: Error: EPERM: operation not permitted, rename
  '...\session-leases\<hash>.lock.candidate-7652-...' -> '...\session-leases\<hash>.lock'
supervisor: Worker <id> failed after three recovery attempts
```

**46 stale session-lease lock directories**, orphaned by yesterday's machine
crash, were blocking every worker — and the daemon **cannot self-heal** from
them. `doctor --fix` did not clear them.

This is not a Sophos bug. It is three upstream issues from our own research
report reproducing live:

| Upstream issue | What we hit |
|---|---|
| **#667** Windows: a stale session lease blocks session recovery | 46 orphaned `.lock` dirs |
| **#841** crashed worker leaves stale lease locks; **daemon cannot self-heal** | `doctor --fix` kept, did not clear |
| **#666** Windows: `fsync` on a directory handle fails with EPERM | `EPERM ... fsync` throughout the log |
| **#1045** one failed worker descriptor poisons global state | a dead `tcp://127.0.0.1:48341` descriptor kept reappearing in `status` |

**Recovery performed** (state backed up first, never deleted blind):
1. `shutdown --force`, then killed the two orphaned daemon processes.
2. Backed up + cleared the 46 lease locks → `session-leases-stale-backup-20260809/`.
3. Backed up + removed the poisoned worker descriptor → `daemon-workers-stale-backup-20260809/`.

After that the daemon started clean.

### A second upstream bug reproduced, diagnosed by the model itself

With the daemon live, `models` returned a real streamed answer in which the
model diagnosed its own harness:

> "The path `C:\Users\Cayleb\.prime\agent\kernel-venv\bin\python` uses a
> **Unix-style path** (`bin/python`), but on **Windows** the venv interpreter
> lives at `Scripts\python.exe`."

Confirmed on disk: `Scripts/python.exe` **exists**, `bin/python` **does not**.
That is **upstream #660** — the top Windows blocker in our research — reproduced
live. Consequence: the IPython kernel never boots, so the agent has no Python
tool. **The model API works; the code-execution tool does not.**

---

## 2. Live IPC round-trip

`verify/ipc-roundtrip.mjs` against the real daemon + real bridge:
**56/56 PASS, 0 FAIL.**

(The bridge had never been built in this checkout — `bridge/dist` was missing.
Built it; output lands at `bridge/dist/bridge/src/index.js`.)

---

## 3. The safety controls — `verify/live-safety-controls.mjs`

| Check | Result | Evidence from the real daemon |
|---|---|---|
| Real daemon listening | **PASS** | `tcp://127.0.0.1:48554` |
| Bridge connected to it | **PASS** | `status.kind = "connected"` |
| Daemon reports `costStats` — the breaker's **spend** input | **PASS** | `{"totalCost":0,"inputTokens":0,"outputTokens":0}` |
| Daemon reports context tokens — the breaker's **token** input | **PASS** | `tokens=0 window=1000000` |
| A real `refine()` yields a **reviewable proposal** | **PASS** | `refinement_result` emitted with **`appliedEdits=[]`** |
| **Dead-engine detection fires** | **PASS** | daemon killed → bridge reported `disconnected`/`reconnecting` |

### What each result actually means

- **The approve-gate is load-bearing against the real engine.** A live `refine()`
  returns a proposal the daemon has **not applied** (`appliedEdits=[]`). The
  client gate therefore has something genuine to hold, and
  `handleRefinementResult` treats a real event identically to a mock one — with
  `autoApply` **OFF by default**, it lands in `pending` awaiting explicit
  Apply/Discard. The self-editing loop genuinely cannot complete without a human.
- **The circuit-breaker is wired to live data, not dead fields.** The daemon
  really does populate `costStats` and `context.tokens` — the exact inputs
  `useRunGuard` trips on. A breaker reading fields the daemon never sends would
  be decorative; this one is not.
- **Dead-engine detection is real.** Killing the daemon produced a genuine
  disconnect event — the input for guardrail (e1), the answer to upstream #764's
  $272 runaway against a dead kernel.

---

## 4. Honest limits of this run

| Claim | Status |
|---|---|
| Approve-gate holds a **real** daemon refinement | **PROVEN** |
| Breaker's inputs are **really reported** by the daemon | **PROVEN** |
| Dead-engine signal fires on **real** daemon loss | **PROVEN** |
| Breaker **trips at a threshold under real spend** | **NOT PROVEN HERE** — see below |
| Full flow inside the **packaged Tauri app** | **NOT PROVEN HERE** — see below |

**Why the threshold trip is not proven live.** The breaker fires when
`cost >= maxCost` **and** a goal or autonomous run is active. On a fresh session
the real daemon reports `totalCost: 0` and **no `autonomousConfig`** (absent →
client treats the loop as inactive). Forcing a real trip would mean running an
autonomous loop until it burned real money against a live provider. The
threshold arithmetic is already covered deterministically by
`verify/v3-gate-behaviour.py` (10/10); what this run adds is proof the **inputs
are real**. Reaching a live trip is a deliberate spend decision for the operator,
not something to do unannounced.

**Why not the packaged app.** The shipped installer
(`Sophos_0.1.0_x64-setup.exe`) is dated **Aug 8 20:23** — before this week's
research, UX work, safety gates, and both redesigns. Testing it would test the
wrong build. A rebuild is the prerequisite for an in-app run.

---

## 5. Artifacts

- `verify/live-safety-controls.mjs` — repeatable live-engine safety probe
- `verify/ipc-roundtrip.mjs` — 56/56 live IPC round-trip
- `~/.prime/agent/session-leases-stale-backup-20260809/` — the 46 cleared locks
- `~/.prime/agent/daemon-workers-stale-backup-20260809/` — cleared descriptors

## 6. Hygiene

All daemon, bridge, and browser processes terminated and verified clear
(`0` daemon/bridge node processes, `0` headless Chrome). No order, payment, or
account mutation occurred; no credentials were typed or displayed.
