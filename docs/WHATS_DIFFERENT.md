# What Sophos Does Differently from Upstream Prime Agent

> Release notes for the Sophos Windows port, mapped to what real users
> complained about in the upstream Prime Agent issue tracker, community
> reviews, and Hacker News (research dated 2026-08-09, 178 GitHub issues
> analysed).

Upstream Prime Agent is macOS/Linux-first. Windows was the single largest
complaint cluster — and the rough edges that made users call the harness
"unreachable" were concentrated in exactly the surfaces a polished desktop
app controls. This document maps every meaningfully different thing Sophos
does to the complaint that motivated it.

---

## 1. Windows actually works

The top upstream complaint: **Windows is a second-class citizen.** 17
Windows-specific issues covered the kernel never booting, console windows
leaking, venv paths being wrong, and installers that didn't exist.

| Upstream complaint | Sophos fix |
|---|---|
| **#660** Kernel bootstrap uses `bin/python` (POSIX); on Windows the venv interpreter lives at `Scripts/python.exe`, so the IPython kernel **never starts** and the agent has no execution tool. | The Tauri shell resolves the real Windows interpreter and passes it via `PRIME_AGENT_KERNEL_PYTHON`. Verified: the installed app executes Python and reports live interpreter state. |
| **#665 / #719** No Windows installer at all; "doesn't work on Windows". | A signed NSIS installer and MSI, built fresh from current source, installs to `~\AppData\Local\Sophos` with a bundled Node runtime, daemon, and bridge. No admin, no manual dependency install. |
| **#735 / #668 / #869** Multiple console windows steal focus on launch and on every tool call. | Tauri spawns the daemon and bridge with `CREATE_NO_WINDOW` (hides those two processes). Because that flag does **not** propagate to grandchildren, the daemon is also launched with a `--require` preload (`scripts/no-window-preload.cjs`) that defaults every daemon-side `child_process` spawn (`spawn`, `spawnSync`, `exec`, `execSync`, `execFile`, `execFileSync`) to `windowsHide: true` — so the daemon's own children (kernels, shells, tool processes) no longer flash or steal focus. Explicit `windowsHide` values are preserved. |
| **#666 / #667 / #841 / #1045** `fsync` EPERM, stale session leases, crashed-worker lock directories, and poisoned worker descriptors make a crashed Windows host effectively unrecoverable without manual filesystem surgery. | The bundled runtime clears stale leases and orphaned worker descriptors at startup, so a host restart no longer bricks every session. |
| **#735 / #1023 / #1047** Shell-resolution bugs (Git Bash required, `%%bash` routing into WSL, `npm run check` failing without POSIX `sh`). | Bundled Node runtime and internal shell resolution remove the Git Bash dependency entirely. |

**Result:** upstream's #1 complaint — "doesn't work on Windows" — is the
one Sophos was built to solve, and the install path is now the default,
not an afterthought.

---

## 2. The agent asks before it rewrites itself

The single most disqualifying upstream concern, cited by multiple reviewers
as the reason they would not deploy the tool on a machine holding credentials:
a self-editing loop with no human gate.

| Upstream complaint | Sophos fix |
|---|---|
| **D37 / D38 / F17** The `/refine` self-editing loop is a dealbreaker for security-conscious users. "Who holds the pen on the agent's own instructions… a self-editing loop with no human gate is how a system drifts silently." | Refinement results arrive as a **pending proposal**. The user sees the proposed change and must explicitly **Apply** or **Discard**. Auto-apply is opt-in and **OFF by default**. Verified end-to-end against the real daemon: a live refinement arrives with `appliedEdits=[]` (not silently applied). |
| **L4 / D38** Reviewers *praised* the README's candor that the kernel runs model-generated code with user permissions and is "not a security sandbox". | An in-app **Trust model** disclosure card in Settings → Advanced tells the user plainly that Sophos executes model-generated code with their permissions and is not a sandbox — surfacing upstream's praised honesty in the UI, not just the docs. Uses the design system's semantic amber caution tone, not success-green. |

**Result:** the #1 security dealbreaker is converted into a differentiator —
the agent visibly cannot edit its own instructions without a human decision.

---

## 3. The circuit-breaker that stops a $272 runaway

The most expensive documented upstream failure: a dead IPython kernel that
never reprovisions, wrapped in an active goal loop, billing **$272.39 over
9.5 hours** against a corpse (issue #764, the same issue that opened with
*"This tool is phenomenal."* — an invested user, not a detractor).

| Upstream complaint | Sophos fix |
|---|---|
| **D36b / #764** Dead kernel + goal loop = unrecoverable continuation loop ($272.39, 873 turns, 176M tokens). | A client-side **run-guard** watches real daemon telemetry (`costStats`, `context.tokens`, connection status) and surfaces a prominent **"budget reached — resume?"** state when a loop exceeds its cost, token, or iteration budget. A dead-engine detector surfaces **"kernel is down — restart?"** instead of billing against a corpse. |
| **D28 / #986** Goal mode loops forever after completion. | A **goal-loop watchdog** trips the run guard when a goal stays active past its configured turn or token limit. |
| **D30 / #1054** Child-usage-attribution flood freezes the session worker (550+ events in 20 min). | The frontend **coalesces** high-frequency agent/usage events so a burst cannot lock the UI. |
| **D29 / #1000** Programmatic prompts starve at idle for 8+ hours until a human types. | The bridge now guarantees queued programmatic prompts are delivered even when idle. |
| **D41** "This seems like it's going to rip through tokens like crazy… at current economics it's not feasible." | Session cost and working-directory are **persistently visible** in the status bar (complaints F3/F4/D41), and autonomous/refine modes show a visible **budget strip** with the configured cap before you start. |

**Verified:** the breaker inputs are real — the daemon actually reports
`costStats` and `context.tokens`; killing the daemon produces a genuine
disconnect event; and a live refinement arrives unapplied, awaiting approval.

---

## 4. Onboarding that doesn't trap you

| Upstream complaint | Sophos fix |
|---|---|
| **D12 / #992** Onboarding gives no indication you can skip login and set API keys directly. | A **skippable, provider-first first-run banner** points at Settings → Providers as the primary path, explains API keys are an alternative to OAuth, and can be dismissed with a Skip button or ESC. Dismissal persists to `localStorage`. |
| **D13–D19** OAuth failures: ChatGPT `invalid_client`, Copilot `service_tier`, no xAI, no Ollama Cloud, no way to copy the OAuth URL on headless/SSH hosts. | **Copyable OAuth sign-in link** with a "Copied" confirmation (complaints D14/D19/F2), API-key entry promoted to a **first-class alternative** for every provider (not a fallback), and a subscription provider shipped in the demo data so the OAuth path is reachable without patching. |
| **D43 / D22** Users confused about their current working directory. | The working directory is **persistently shown** in the SystemBar, truncated in the middle so the meaningful tail stays visible, full path on hover. |
| **D41 / F3 / F4** Session token cost hidden behind a menu. | Session cost is **persistently shown** in the SystemBar (complaints F4/D41), with full token breakdown on hover. |

**Result:** the first impression is no longer a login trap, and the two
data points users most often asked for (cost, folder) are always visible.

---

## 5. An agentic surface that tells you what's happening

Upstream users found long-running features "hard to reach and understand,"
with empty states that looked unfinished and status that was ambiguous.

| Upstream complaint | Sophos fix |
|---|---|
| **D28–D36b (general)** "Unreachable in practice." | **Honest empty/not-running states** across every agentic view (Goals, Autonomous, Heartbeats, Schedules, Refinement, Agents, Inbox) that explain what the feature does, what turns it on, and what to expect — not marketing copy, operator-grade explanation. |
| **D28** Ambiguous autonomous/refine status. | **AUTO** and **REFINE** indicators surface in the SystemBar *only when they need the user* (autonomous running, refinement awaiting review). Green returns to being a signal, not decoration. |
| **D28 / D36b** No visibility into whether a loop is making progress. | **Stall detection** surfaces a "no progress for N minutes" indicator with a stop/nudge action; heartbeat/schedule health shows last-fired and next-due. |

---

## 6. Visual design that matches upstream's editorial language — without the cockpit

Upstream reviewers praised the architecture but repeatedly called the TUI
"flight-deck instrument" — dense, box-in-box, competing for attention.

| Upstream complaint | Sophos fix |
|---|---|
| **D40** "They shipped slop" — dense, instrument-like panels. | A complete **visual redesign** of all 9 views against a design system derived from https://www.primeintellect.ai/ (scraped live): sharp `#0e0e0e` ground, hairline `#2a2a2a` borders, Geist + Geist Mono typography, terminal green `#85ed75` as the **sole** accent, opacity-based text hierarchy. |
| Box-in-box density. | Bordered containers **10 → 3** per view; empty states are now unboxed; telemetry strips are inline text, not cards. |
| Green used decoratively. | Green tightened from **53 elements/view to 24** (Sessions); reserved for live/active/attention. |
| Captions truncated mid-word. | `word-break: break-all` removed; values wrap at word boundaries or use two-line clamp. |
| Inconsistent navigation depth. | Long-running sections collapsed from **three tiers to two**; Sessions/Agents headers collapsed from 9 bands to 1–2. |

**Measured result across four scoring rounds:** the set went **0.60 → 0.80
→ 0.85 → 0.86–0.89**. Sessions (the worst screen) went **0.75 → 0.88**.

---

## 7. Quality infrastructure that proves the claims

Every claim above is backed by a repeatable, machine-readable check — not a
screenshot or a worker's say-so.

| Harness | What it proves |
|---|---|
| `verify/live-safety-installed.mjs` | Python execution, breaker inputs, approve-gate, and kernel fix — against the **installed** app's shipped binary. |
| `verify/live-safety-controls.mjs` | The same, against a fresh real daemon + bridge. |
| `verify/ipc-roundtrip.mjs` | 56/56 IPC commands round-trip over the real bridge. |
| `verify/e2e-browser.mjs` | 36/36 browser-driven tests on the live dev server. |
| `verify/v1-visual-match.py` + `verify/v1-reference-compare.py` | Per-view computed-style sweep + live-reference token diff. |
| `verify/e2e-isolate.mjs` | Runs named tests in a **fresh browser each, repeated N times** to distinguish real regressions from environment flakes. |
| `verify/v2-details-toggle.py` | 16/16 behavioural checks on the SystemBar Details panel. |
| `verify/v3-gate-behaviour.py` | 10/10 approve-gate property checks. |
| `verify/v3-capture-states.py` | 13/13 captures of the two UI states the default screenshots never reached. |

---

## What Sophos does NOT fix (deliberately, or because it's upstream's)

Some upstream complaints are **outside the scope of a desktop port** — they
live in the daemon itself, and patching the bundled daemon would be
overwritten on every upstream sync. These are recorded here so the list is
honest:

- **#666 / #667 / #841 / #1045** — the underlying daemon lease/fsync bugs; Sophos works around them with startup cleanup but the root cause is upstream's.
- **#986** — goal-looping logic in the daemon's continuation engine; Sophos adds a client-side watchdog that surfaces and stops the loop.
- **#1000** — programmatic-prompt delivery timing in the daemon; Sophos guarantees delivery at the bridge layer.
- **#1054** — child-usage event volume in the daemon; Sophos coalesces at the UI layer.
- **D37** — the daemon-side `/refine` apply path; Sophos adds the client-side gate (the proposal arrives unapproved; that is the load-bearing change).

Where a root-cause fix belongs upstream, a reproduction and a suggested fix
are documented in `research/upstream-660-report.md` (ready to post).

---

## Sources

- `research/user-feedback-audit.md` — 178 GitHub issues, HN thread #49189075 (252 points), 6 hands-on blog reviews, upstream docs.
- `research/sophos-design-dna.md` — scraped live from https://www.primeintellect.ai/.
- `research/pi-website-ref/` — 7 scroll-position screenshots + live `:root` CSS.
- `research/upstream-660-report.md` — ready-to-post upstream bug report with exact file/line locations.
