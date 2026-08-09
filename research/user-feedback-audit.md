# User Feedback Audit — Prime Agent (upstream) → Sophos (Windows port)

**Prepared:** 2026-08-09
**Scope:** What real users LIKE and DISLIKE about the original Prime Agent harness
(`PrimeIntellect-ai/prime-agent`), plus actionable improvements for **Sophos**, the
Tauri+React Windows desktop port.
**Method:** Read upstream docs + AGENTS.md; pulled all 178 GitHub issues (open + closed)
via `gh`; web-searched Reddit, Hacker News, X, and hands-on blog reviews via DuckDuckGo.
**Honesty note up front:** Prime Agent is **new** (released 2026-08-05). Community
discussion is thin and concentrated in the first week. There is **no meaningful Reddit
thread** about the harness itself (Reddit results are about Prime Intellect's *models*,
Intellect1/Intellect2, not the agent), and **no X/Twitter thread** was retrievable. The
bulk of real user feedback lives in the **178 GitHub issues** (many filed by users who
actually installed and ran it) plus **one substantive Hacker News thread** and a handful
of hands-on blog reviews. That absence of broader community discussion is itself a
finding: the product is too new for a large user base, so the issue tracker is the
highest-signal source.

---

## Section 1 — What Users LIKE

| # | Finding | Source | Date |
|---|---------|--------|------|
| L1 | **Architecture is genuinely praised.** "One of the most technically interesting coding-agent harnesses of 2026… Architecture and ambition are excellent." | kingy.ai review (hands-on, built v0.7.0) | 2026-08-05 |
| L2 | **The RLM / persistent-IPython design is seen as a real departure.** "The most serious public implementation yet" of self-improving harness ideas; "a new paradigm on the design of agent harnesses." | bmdpat.com review; nextbigfuture.com | 2026-08-05/06 |
| L3 | **Third-party adoption signal.** Orca (an open-source agentic IDE) shipped prime-agent integration (launch + session history) — a positive sign that the harness is worth embedding. | GitHub issue #808 | 2026-08-07 |
| L4 | **Candid security documentation is appreciated.** Reviewers credit the README for being direct that the kernel is "not a security sandbox" and that model-generated Python runs with user permissions. | kingy.ai; bmdpat.com; README warning | 2026-08-05 |
| L5 | **"Might actually try this"** — early HN sentiment was curious/positive on the concept. | HN thread #49189075 | 2026-08-05 |
| L6 | **Token-efficiency framing resonates.** The idea of keeping context out of the prompt and querying it on demand (context-as-variable) is repeatedly called out as the core value. | nextbigfuture; remio.ai; orcarouter.ai | 2026-08-05/06 |
| L7 | **"This tool is phenomenal."** — unprompted praise from a user opening a *bug* report, i.e. a user invested enough to keep using it through a hard crash. The strongest single signal of genuine user affection in the tracker. | GitHub #764 (`mrairdon-midmark`) | 2026-08-06 |

**Takeaway for Sophos:** the *concept* sells. Users who evaluate it are impressed by the
architecture. The friction is all in the *experience* (install, Windows, provider auth,
long-running reliability) — which is exactly the surface a polished desktop port can win on.

---

## Section 2 — What Users DISLIKE

### 2a. Installation & onboarding friction (highest volume of complaints)

| # | Finding | Source | Date |
|---|---------|--------|------|
| D1 | **No supported Windows install path.** README + quickstart document macOS/Linux only; Windows users have no documented way to install. | GitHub #665 | 2026-08-06 |
| D2 | **"Doesn't work on Windows"** (bare report). | GitHub #719 | 2026-08-06 |
| D3 | **On Windows it spawns multiple terminals** when launching, and again per prompt. | GitHub #735 | 2026-08-06 |
| D4 | **Windows kernel bootstrap is broken:** builds `<venv>/bin/python` (POSIX layout) instead of `<venv>/Scripts/python.exe`, so the IPython kernel never starts and each retry wipes the venv. Since IPython is the agent's *only* tool, the agent comes up with no ability to act. | GitHub #660 | 2026-08-06 |
| D5 | **`install.sh` fails** for users (DNS resolution of the release manifest host). | GitHub #676 | 2026-08-06 |
| D6 | **Installer fails when npm's global prefix isn't user-writable** (EACCES on `/usr/local/lib/node_modules`). | GitHub #705 | 2026-08-06 |
| D7 | **Installer prints unsupported `npm bin -g` recovery instructions** (removed in npm 10+). | GitHub #749 | 2026-08-06 |
| D8 | **Install fails on npm 12+** (`allow-remote=none` default) with no warning. | GitHub #741 | 2026-08-06 |
| D9 | **Official install breaks `npm update -g`** (registry 404 for `prime-agent`). | GitHub #1042 | 2026-08-09 |
| D10 | **"Installer might look pretty but it installs to the homebrew dir, despite not being a homebrew package. Very dirty. No uninstall method."** | HN #49189075 (`_joel`) | 2026-08-05 |
| D11 | **Ctrl-C during the animated install step orphans a background npm process and leaks a temp dir.** | GitHub #1008 | 2026-08-08 |
| D12 | **Onboarding gives no indication you can skip login** and set API keys directly. | GitHub #992 | 2026-08-08 |

### 2b. Provider / authentication friction

| # | Finding | Source | Date |
|---|---------|--------|------|
| D13 | **ChatGPT Plus/Pro OAuth fails with `invalid_client`** before the callback. | GitHub #812 | 2026-08-07 |
| D14 | **OpenAI OAuth via SSH is broken** (copy-pasting the sign-in link doesn't complete). | GitHub #736 (closed) | 2026-08-06 |
| D15 | **GitHub Copilot models fail with 400 `service_tier is not supported`** (works in `pi`). | GitHub #645, #720 | 2026-08-05/06 |
| D16 | **No xAI (Grok/X subscription) login option** — API-key only, which is separately paid. | GitHub #678 | 2026-08-06 |
| D17 | **RLM subagents can't use models the parent can** (Codex model discovery sends the wrong `client_version`; Copilot `service_tier`). | GitHub #639, #702, #1011 | 2026-08-05/08 |
| D18 | **Ollama Cloud is not available as a provider.** | GitHub #1041 | 2026-08-09 |
| D19 | **No way to copy the OAuth sign-in URL** on headless/SSH hosts (only way forward is the on-screen URL). | GitHub #643 | 2026-08-05 |

### 2c. TUI / interactive UX bugs

| # | Finding | Source | Date |
|---|---------|--------|------|
| D20 | **TUI crashes** with `Cannot read properties of null (reading 'type')` while streaming a compact assistant delta (5 subagents streaming concurrently). | GitHub #648 | 2026-08-05 |
| D21 | **Vim composer (Ctrl-G) is "effectively unusable"** — duplicate key presses (`w`→`ww`, `:q`→`:;qq`). | GitHub #811 | 2026-08-07 |
| D22 | **`/resume` slash command doesn't exist** in interactive mode even though `--resume` is documented. | GitHub #679 | 2026-08-06 |
| D23 | **Session becomes laggy after being left open overnight**, even after restart/re-entry; UI refreshes/resizes itself. | GitHub #774 | 2026-08-06 |
| D24 | **No safeguard against degenerate model repetition** — a thinking stream emitted "The the the…" ~2,365 times until manual abort. | GitHub #1029 | 2026-08-09 |
| D25 | **Fuzzy-edit fallback silently rewrites the entire file** and the reported diff hides it. | GitHub #654 | 2026-08-05 |
| D26 | **Queued message visually duplicates** during `/compact`. | GitHub #698 | 2026-08-06 |
| D27 | **TUI input crashes** wrapping a wide grapheme in a narrow pane; unrecoverable stuck paste state. | GitHub #982 | 2026-08-08 |

### 2d. Long-running / agentic reliability (the "built for long-running work" promise)

| # | Finding | Source | Date |
|---|---------|--------|------|
| D28 | **Goal Mode loops forever after completion** — keeps injecting `goal_context` continuations with no actionable work. | GitHub #986 | 2026-08-08 |
| D29 | **Programmatic prompts starve at idle sessions** — subagent results and scheduled follow-ups queue for 8+ hours until a human types. | GitHub #1000 | 2026-08-08 |
| D30 | **Child usage-attribution flood freezes the session worker** — 550+ `child_usage_attributed` entries in 20 min with active subagents; attach/heartbeats time out. | GitHub #1054 | 2026-08-09 |
| D31 | **Compaction can permanently self-amplify** into an unresponsive loop from retry debris + unbounded summary input. | GitHub #900 | 2026-08-08 |
| D32 | **Continual-harness memory is "unreachable in practice"** — the prompt overview is a hardcoded 6-entry alphabetical head slice; `rlm.harness` defaults to an empty session-local store in spawned children. | GitHub #819 | 2026-08-07 |
| D33 | **Queued agent mail is delivered one message per turn, stale, and blind to the backlog.** | GitHub #823 | 2026-08-07 |
| D34 | **Heartbeats that coincide with a busy session are dropped, not deferred**, with no run counter or skip notice. | GitHub #820 | 2026-08-07 |
| D35 | **`-p` (single-shot) mode exits before post-turn work completes** — `rlm()` subagents silently discarded, auto-refine never fires. | GitHub #792 | 2026-08-06 |
| D36 | **Headless execution terminates prematurely on compaction.** | GitHub #674 | 2026-08-06 |
| D36b | **Kernel crash leaves the session permanently dead — the most expensive documented failure.** An unexpected kernel exit marks the session `shutdown`; `start()` only proceeds from `idle` and the working `restart()` is never invoked, so Python never responds again. The only recovery a user found was `prime-agent shutdown` + resume. With an active goal + heartbeat this became an unrecoverable continuation loop: 873 assistant turns, 694 goal continuations, 176M tokens, **$272.39** over ~9.5 hours. | GitHub #764 | 2026-08-06 |

### 2e. Trust / security model (conceptual concern, not a bug)

| # | Finding | Source | Date |
|---|---------|--------|------|
| D37 | **The `/refine` self-editing loop is a dealbreaker for security-conscious users.** (paraphrase, assembled from the source's phrasing) "who holds the pen on the [agent's own instructions]… a self-editing loop with no human gate is [how a system drifts silently]." The Factorio demo (agent spawned resources over RCON despite a "don't cheat" reminder) is cited as evidence a reminder is not a gate. | bmdpat.com review | 2026-08-08 |
| D38 | **Kernel runs model-generated Python with user OS permissions and is "not a security sandbox"** — disqualifying on a machine holding credentials. | bmdpat.com; kingy.ai; README | 2026-08-05/08 |
| D39 | **Persistence preserves mistakes and unsafe instructions** — the improvement mechanism expands the trust boundary. | remio.ai | 2026-08-07 |
| D39b | **Stale daemon lock blocks restart after upgrade** ("Lock file is already being held") — same lock/lease-recovery class as the Windows lease bugs (W6/W10), but reported on macOS, showing the class is cross-platform. | GitHub #1014 | 2026-08-09 |

### 2f. Code quality & economics criticism (HN)

| # | Finding | Source | Date |
|---|---------|--------|------|
| D40 | **"They shipped slop"** — LLM-generated code with little review: multiple files near 10K LOC, a switch statement spanning 1000+ lines. | HN #49189075 (`embedding-shape`, `trenchgun`) | 2026-08-05 |
| D41 | **Token economics concern:** "this seems like it's going to rip through tokens like crazy… at current economics it's not feasible." | HN #49189075 (`zuzululu`) | 2026-08-05 |
| D42 | **Benchmark opacity:** the 95.5% ARC-AGI-3 score is vendor-reported, not on the official ARC leaderboard; "it's likely that it gave itself more than the maximum number of tries… or even hardcoded the answers." | HN #49189075 (`noahbp`, `andriy_koval`); orcarouter.ai | 2026-08-05/06 |
| D43 | **"Without any concrete examples of performance on real tasks it's just a pretty idea."** | HN #49189075 (`znnajdla`) | 2026-08-05 |

---

## Section 3 — Feature Requests / Desired Improvements

| # | Request | Source | Date |
|---|---------|--------|------|
| F1 | **Skip-login onboarding** — "Press ESC to skip" and set API keys directly. | GitHub #992 | 2026-08-08 |
| F2 | **Copy the OAuth sign-in URL** from the login dialog (`c` to copy) for headless/SSH. | GitHub #643 | 2026-08-05 |
| F3 | **Show the current working directory** in the interactive session tray. | GitHub #693 | 2026-08-06 |
| F4 | **Show session token cost persistently** in the tray/status line (not just `/context`). | GitHub #894 | 2026-08-08 |
| F5 | **Install via npm registry** (publish to npm; side-channel tarball install "doesn't engender trust"). | GitHub #671 | 2026-08-06 |
| F6 | **Hooks support** (general extension hooks). | GitHub #872 | 2026-08-07 |
| F7 | **ACP features completion** (Agent Client Protocol). | GitHub #1040 | 2026-08-09 |
| F8 | **Ollama Cloud as a provider.** | GitHub #1041 | 2026-08-09 |
| F9 | **Opus 5 / Opus 4.8 fast support** on Anthropic API. | GitHub #867 | 2026-08-07 |
| F10 | **Scoped execution + caller-granted capabilities** for RLM subagents. | GitHub #896 | 2026-08-08 |
| F11 | **Persistent default model/provider policy for RLM subagents.** | GitHub #921 | 2026-08-08 |
| F12 | **Subagent composition knobs** — per-child thinking level, skill selection, bundled-skill granularity. | GitHub #703 | 2026-08-06 |
| F13 | **Optional server-backed long-term memory** (Hindsight). | GitHub #769 | 2026-08-06 |
| F14 | **Pre-query enrichment rules.** | GitHub #797 | 2026-08-06 |
| F15 | **ACP client-backed external child agents.** | GitHub #739 | 2026-08-06 |
| F16 | **`/cd` command** to change an active session's working directory. | GitHub #681 | 2026-08-06 |
| F17 | **Show `refine.run()` diff before applying, not after.** | GitHub #684 | 2026-08-06 |
| F18 | **OSC 8 hyperlinks** in supported tmux sessions. | GitHub #686 | 2026-08-06 |
| F19 | **Meta Model API support** (Muse Spark). | GitHub #692 | 2026-08-06 |
| F20 | **Prefer `attach_image` (model vision) over IPython/PIL/OCR** for on-disk image analysis. | GitHub #728 | 2026-08-06 |
| F21 | **Devin (Cognition) as a provider** (closed — withdrawn). | GitHub #753 | 2026-08-06 |
| F22 | **Exa and Parallel as built-in web research integrations** (withdrawn). | GitHub #870 | 2026-08-07 |

---

## Section 4 — Windows-Specific Feedback (critical for Sophos)

The upstream project is **macOS/Linux-first**; Windows is a second-class citizen and the
issue tracker is full of Windows breakage. This is the single biggest opportunity for a
Windows-native port.

| # | Finding | Source | Date |
|---|---------|--------|------|
| W1 | **No supported Windows install path** — installer and docs cover macOS/Linux only. | GitHub #665 | 2026-08-06 |
| W2 | **"Doesn't work on Windows."** | GitHub #719 | 2026-08-06 |
| W3 | **Multiple terminals spawn** on launch and per prompt. | GitHub #735 | 2026-08-06 |
| W4 | **Kernel bootstrap uses POSIX venv layout** (`bin/python` not `Scripts/python.exe`) → IPython kernel never starts, venv wiped each retry. | GitHub #660 | 2026-08-06 |
| W5 | **`fsync` on a directory handle fails with EPERM.** | GitHub #666 | 2026-08-06 |
| W6 | **A stale session lease blocks session recovery.** | GitHub #667 | 2026-08-06 |
| W7 | **Detached child processes open visible console windows.** | GitHub #668 | 2026-08-06 |
| W8 | **Daemon-worker shell commands spawn visible focus-stealing console windows** (worker has no console to inherit). | GitHub #869 | 2026-08-07 |
| W9 | **Daemon recovery doesn't terminate unassigned orphan process trees.** | GitHub #917 | 2026-08-08 |
| W10 | **Crashed worker leaves stale session-lease lock dirs**; all subsequent resumes fail with EPERM and the daemon can't self-heal. | GitHub #841 | 2026-08-08 |
| W11 | **`%%bash` cells execute inside WSL** instead of the resolved shell. | GitHub #1047 | 2026-08-09 |
| W12 | **Owned session worker skips graceful shutdown** and misses a killed frontend. | GitHub #1048 | 2026-08-09 |
| W13 | **Kernel `dispose()` returns before the kernel exits**, leaving its working directory locked on Windows. | GitHub #1049 | 2026-08-09 |
| W14 | **`--daemon-socket` with a filesystem path can't bind or connect.** | GitHub #1050 | 2026-08-09 |
| W15 | **`uv` discovery ignores PATHEXT**, so a `uv.cmd` shim is never found. | GitHub #1052 | 2026-08-09 |
| W16 | **`npm run check` fails on Windows when POSIX `sh` is unavailable.** | GitHub #1023 | 2026-08-08 |
| W17 | **Windows requires a bash shell** (Git Bash / Cygwin / MSYS2 / WSL) — documented in `docs/windows.md`; a hard external dependency. | upstream `windows.md` | — |

**Pattern:** Windows issues cluster around (a) **process/console lifecycle** (W3, W7, W8,
W9, W12), (b) **file-lock / lease recovery** (W5, W6, W10, W13), (c) **path/venv layout**
(W4, W15), and (d) **shell resolution** (W11, W16, W17). A Windows-native port that
bundles its own runtime and supervises processes cleanly (as Sophos does with Tauri +
bundled Node) directly addresses the highest-volume complaint class.

---

## Section 5 — Actionable Recommendations for Sophos

Sophos already neutralizes the #1 complaint (no Windows support) by being a Windows-native
app with a bundled runtime. The recommendations below target the remaining friction that
real users reported, mapped to what a desktop port can actually control.

### High priority

1. **Make first-run onboarding skip-able and provider-first (F1, D12).** Upstream users
   complained there's no way to skip login and go straight to API keys. Sophos's
   Settings → Providers flow should be the *default* first-run path, with a clear
   "Skip / set keys later" affordance and a visible "Press ESC to skip" equivalent. This
   is the first impression and it's currently a known pain point.

2. **Surface token cost and working directory persistently (F3, F4).** Users explicitly
   asked for session token cost and the current working directory in the status line.
   Sophos's Chat view should show both in a persistent status bar (not hidden behind a
   menu), because cost visibility is a top-of-mind concern (D41) and cwd confusion is a
   real UX gap (D43/D22).

3. **Add a human gate to `/refine` (D37, D38, F17).** The single most disqualifying
   concern for security-conscious users is the self-editing loop with no human review.
   Sophos should make refine **review-and-approve by default**: show the proposed diff
   *before* applying (F17), require an explicit "Apply" click, and surface a clear
   "not a sandbox" warning on first run. This converts a dealbreaker into a differentiator
   for a desktop app that may sit on a machine holding credentials.

4. **Harden the long-running/agentic reliability surface (D28–D36b).** The "built for
   long-running work" promise is undermined by goal-looping, idle prompt starvation,
   usage-attribution floods, compaction self-amplification, and — most expensively — a
   dead kernel that never reprovisions (D36b, #764: $272.39 burned over 9.5 hours in an
   unrecoverable goal-continuation loop). For a desktop app that users leave open, Sophos
   should: (a) cap/coalesce child-usage attribution events, (b) guarantee queued
   programmatic prompts are delivered even when idle, (c) add a goal-loop watchdog,
   (d) bound compaction summary input, and **(e) add a spend/iteration circuit-breaker
   plus a dead-kernel detector that surfaces "kernel is down — restart?" instead of
   letting a goal loop bill against a corpse.** These are the bugs that make a session
   "unreachable" — the worst failure mode for a GUI app, and the one with a real dollar
   cost attached.

5. **Eliminate the bash dependency and console-window leaks (W3, W7, W8, W11, W16, W17).**
   Upstream requires Git Bash and leaks visible console windows. Sophos bundles its own
   Node runtime; it should also resolve a shell internally (or document a bundled Git-for-
   Windows) and ensure all child processes are spawned hidden/headless so no focus-stealing
   console windows appear. This is the most visible "it feels native" win.

### Medium priority

6. **Provider auth reliability (D13–D19).** OAuth failures (ChatGPT `invalid_client`,
   Copilot `service_tier`, no xAI, no Ollama Cloud) are a top complaint. Sophos should
   (a) support API-key providers as first-class (already does), (b) add Ollama/local-model
   support prominently (F8, and Cayleb's local-first preference), and (c) make the OAuth
   URL copyable (F2) since a desktop app can't always open a browser cleanly.

7. **Graceful process/lease recovery (W5, W6, W10, W13).** Stale session-lease locks and
   locked working directories brick resume on Windows. Sophos's Tauri supervisor should
   detect and clear stale leases on startup and ensure kernel shutdown is awaited before
   releasing the working directory.

8. **Fix the TUI/input edge cases that crash or corrupt (D20, D21, D27).** The null-type
   streaming crash, vim-composer duplicate keys, and wide-grapheme wrap crash are
   reproducible user-facing bugs. A desktop port should regression-test these.

9. **Publish to a proper distribution channel (D10, F5).** Upstream's side-channel install
   and Homebrew-dir pollution drew direct criticism. Sophos's single `.exe` NSIS installer
   with no admin requirement is already the right answer — keep it that way and document
   an uninstall path.

10. **Be honest about the trust model in-app (D37–D39).** Show a first-run warning that
    model-generated code runs with user permissions and is not sandboxed, and make
    autonomous/refine modes opt-in with visible budgets. This matches the README's candor
    that reviewers praised (L4) and pre-empts the security concern.

### Low priority / watch

11. **Watch the code-quality criticism (D40).** HN called the codebase bloated. Sophos
    doesn't need to fix upstream's code, but should keep its own bridge/frontend lean and
    reviewed to avoid inheriting the "shipped slop" perception.
12. **Benchmark claims (D42).** Don't market Sophos on the vendor-reported ARC-AGI-3 number
    without caveats; reviewers are skeptical of it.

---

## Sources

**GitHub issues** (`PrimeIntellect-ai/prime-agent`, all 178 pulled 2026-08-09 via `gh`):
#665, #719, #735, #660, #676, #705, #749, #741, #1042, #1008, #992, #812, #736, #645,
#720, #678, #639, #702, #1011, #1041, #643, #648, #811, #679, #774, #1029, #654, #698,
#982, #986, #1000, #1054, #900, #819, #823, #820, #792, #674, #808, #693, #894, #671,
#872, #1040, #867, #896, #921, #703, #769, #797, #739, #681, #684, #686, #692, #728,
#753, #870, #666, #667, #668, #869, #917, #841, #1047, #1048, #1049, #1050, #1052, #1023.

**Hacker News:** thread #49189075 "Prime Agent: A self-improving RLM agent" (252 points,
fetched via Algolia API); thread #49190818 (2 points, no comments).

**Blogs / hands-on reviews:**
- kingy.ai — "Prime Agent Review: Self-Improving RLM Harness Explained" (2026-08-05, 8.3/10)
- bmdpat.com — "Prime Agent hit 95.5% on ARC-AGI-3. I did not install it." (2026-08-08)
- orcarouter.ai — "Prime Agent: The Self-Improving RLM Harness That Scored 95.5% on ARC-AGI-3" (2026-08-06)
- remio.ai — "Prime Agent Hit Hacker News, but Its Self-Improving Harness Is the Real Story"
- nextbigfuture.com — "Self Improving Harness" (2026-08-05)
- agentos.guide — "The Self-Upgrade Loop + Prime Agent" (promotional)

**Upstream docs read:** `README.md`, `AGENTS.md`, and `packages/coding-agent/docs/`
(quickstart, sessions, long-running-agents, providers, settings, compaction, tui, windows,
architecture, rlm).

**Surprisingly empty sources:**
- **Reddit:** no substantive thread about the *harness*. Results are about Prime Intellect's
  models (Intellect1/Intellect2) or the ARC-AGI-3 benchmark. The one relevant thread
  (r/singularity, "Prime Agent scores 95% on ARC-AGI-3") is behind Cloudflare and not
  retrievable; its content is captured indirectly via the benchmark-opacity discussion.
- **X/Twitter:** no retrievable user-experience thread; only Prime Intellect's own
  announcement posts.
- **GitHub Discussions:** disabled for the repo (HTTP 410).

---

## Confidence

**Medium.** Real user feedback exists and is concentrated in the GitHub issue tracker
(178 issues, many filed by users who installed and ran the tool) and one substantive HN
thread. But the product is ~4 days old, so there is **no long-tail of community
experience** — no mature Reddit/HN/X corpus, no third-party tutorials with pain-point
postmortems. The Windows findings are the most reliable (they're concrete, reproducible
bug reports). The "LIKES" are largely inferred from reviewers' praise of the architecture
rather than from a large body of happy users. The actionable recommendations for Sophos
are grounded in the strongest evidence (Windows breakage + install/onboarding friction +
long-running reliability bugs), which is exactly the surface a desktop port controls.
