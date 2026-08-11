# Adversarial UX Test — Sophos

Date: 2026-08-11
Target: `http://localhost:1420/` (Vite browser-demo / `MockIpcClient`)
Limitation: no deployed or packaged staging target was available, so live Tauri onboarding and real-provider behavior are not re-proven here. The existing browser suite covers the preview surface only.

## Persona

**Linda Torres**, 59, office manager. She uses WhatsApp, email, and a paper notebook; her son normally installs software for her. She needs one thing: ask Sophos to draft a polite email and get an answer without learning what a daemon, bridge, kernel, model, or provider is.

She gives software ten seconds to make sense. She has bad eyes, dislikes passwords and setup screens, and says: “If I need a tutorial before I can ask one question, I’m going back to Google.”

## Core workflow tested

1. Opened the first screen.
2. Chose the first starter prompt, “Help me debug a function.”
3. Pressed Enter to send it.
4. Waited for the assistant response.

Result: **2 clicks/actions to first answer**, with no console or page errors. The browser demo returned a simulated response and clearly displayed a demo banner, but this is not proof of a real DeepSeek response in the packaged app.

Evidence:

- `01-first-screen.png`
- `02-first-response-busy.png`
- `03-first-response-done.png`
- `observations.json`

## Linda’s review

### Overall

**Maybe.** I can get an answer quickly, but I don’t trust the first screen to tell me whether the answer is real, and I have no idea what half of the setup checklist means.

### The good (grudging admission)

- “I clicked one of the example questions and got moving in two actions. That part is better than a blank box.”
- “The answer visibly streams, and the screen settles back to ready.”
- “The provider window has one clear Cancel button and Escape closes it. I did not get trapped in a popup.”
- “The left-hand labels—Chat, Sessions, Agents, Inbox, Settings—are at least where I expect them.”

### The bad (legitimate UX issues)

- “Why are there two banners telling me different things? One says I’m ready, then another says the engine isn’t connected and the answers are pretend.”
- “Node runtime? Daemon? Bridge? Kernel? I asked for an email, not a computer science exam.”
- “The tiny checklist is five more things to worry about before I even type. If those are important, tell me in normal words.”
- “There are buttons for sessions, agents, inbox, models, context, shell, files, and a command palette before I’ve done anything. This feels like an instrument panel, not an assistant.”

### The ugly (showstoppers)

- “If the screen says ‘You’re ready’ and then gives me a simulated answer, I can’t trust what I’m seeing. I’d uninstall it before using it for work.”

### Specific complaints

1. **First screen / contradictory status:** “You’re ready” and “Start your first conversation” appear alongside “Demo mode — engine not connected. Responses here are simulated.” The expected behavior is one unambiguous state. Evidence: `01-first-screen.png`, `observations.json` first-screen text.
2. **Onboarding terminology:** “Node runtime”, “Daemon”, “Bridge”, and “Kernel” are exposed as tiny labels without visible explanations. The expected behavior is plain-language labels with optional technical details. Evidence: `01-first-screen.png`, `observations.json` terminology scan.
3. **Information density:** The first screen exposes system status, model/provider, five health checks, demo mode, a development-only “Load 500 messages” control, starter prompts, keyboard hints, context usage, and the composer. The expected behavior is to prioritize “ask your first question” and defer internals. Evidence: `01-first-screen.png` and its captured body text.
4. **Setup modal:** “Connect Prime Intellect” is a single modal with OAuth, API key, Copy, Cancel, and Connect. It was understandable and escaped cleanly; this is not a popup defect in the tested path. Evidence: `05-connect-modal.png`, modal count 1 → 0 after Escape.

## Pragmatism filter

| Finding | Class | Reason |
|---|---|---|
| “Ready” plus simulated-response banner conflict | **RED — real UX bug** | Any user can misread readiness; the two status messages contradict each other. |
| Technical prerequisite labels without plain-language meaning | **RED — real UX/accessibility bug** | A competent but busy nontechnical user will not know what action “Kernel” or “Bridge” requires. The text is also micro-sized. |
| First screen shows too many system/developer controls | **RED — real onboarding problem** | It competes with the core task and creates avoidable cognitive load for every new user. |
| “Load 500 messages” visible in demo mode | **YELLOW — valid but low priority** | Confusing to a new user, but likely preview-only and not part of the packaged app. |
| Preference for paper/notebook and dislike of all technical setup | **WHITE — persona noise** | Do not redesign the product to behave like paper or eliminate all configuration for every user. |
| Keep the first question to two actions | **GREEN — feature opportunity** | The starter prompts are a strong aha moment; preserve them while simplifying the surrounding chrome. |
| Live Tauri first-run path and real DeepSeek answer | **UNVERIFIED** | This target was browser-demo only; prior live evidence exists elsewhere but was not refreshed in this session. |

## Tickets created locally

### UX-RED-01 — Do not show “Ready” for simulated browser responses

**Tag:** `ux-review`

> “If the screen says ‘You’re ready’ and then gives me a simulated answer, I can’t trust what I’m seeing.”

**Objective issue:** `FirstRunBanner` treats browser preview as ready while `ChatView` simultaneously shows the demo/disconnected banner. The first-run state is contradictory.

**Suggested fix:** In browser mode, use one neutral state such as “Preview only — connect Sophos to use a real model”; remove the “You’re ready” and “Start chatting” readiness claim. Keep the starter prompts available, but label their responses as simulated.

**Evidence:** `01-first-screen.png`, `02-first-response-busy.png`, `03-first-response-done.png`.

### UX-RED-02 — Translate health checks into user language

**Tag:** `ux-review`

> “I asked for an email, not a computer science exam.”

**Objective issue:** The first-run checklist exposes “Node runtime”, “Daemon”, “Bridge”, and “Kernel” as unexplained micro labels. Hover-only details are not sufficient for a low-vision or nontechnical user.

**Suggested fix:** Show plain-language labels first—“App engine”, “Connection”, “Python workspace”, “Free model”—and put the technical implementation name in an optional details popover or diagnostics panel.

**Evidence:** `01-first-screen.png`, `observations.json` terminology scan.

### UX-RED-03 — Give first-run the single-task layout

**Tag:** `ux-review`

> “This feels like an instrument panel, not an assistant.”

**Objective issue:** The first screen presents several system surfaces and a development-only demo control before the user has completed one task.

**Suggested fix:** On first run, collapse or defer model/context/system controls, hide “Load 500 messages” outside an explicit developer-preview mode, and visually prioritize one starter prompt plus the composer. Restore the full control-room chrome after the first message or an explicit “Show advanced controls” action.

**Evidence:** `01-first-screen.png`, captured first-screen body text.

### UX-GREEN-01 — Preserve starter prompts as the first-run aha moment

**Tag:** `ux-review`

> “I clicked one of the example questions and got moving in two actions.”

**Objective issue:** Starter prompts are the fastest successful path, but their value is diluted by the surrounding setup/status chrome.

**Suggested fix:** Keep the four starter prompts, make the first one a clear primary action, and place them directly under a single plain-language readiness message.

**Evidence:** `01-first-screen.png`, `observations.json` (`starterCount: 4`, `clickCount: 2`).

## Follow-up after overhaul

The RED findings were addressed in the product surface:

- Browser preview now says **Preview mode / Preview only** instead of claiming “You're ready”.
- The preview warning remains explicit that responses are simulated and not connected to DeepSeek or user files.
- Live health checks retain their technical meaning but display plain-language labels: **App engine, Agent service, Connection, Python workspace, Free model**. Technical details remain available through the accessible title/label.
- The performance fixture is behind a **Developer preview** disclosure instead of appearing as a first-run action.
- The starter-prompt path remains two actions to a response.

Follow-up evidence: `follow-up.json` and the refreshed screenshots in this directory.

## Verification notes

- Custom adversarial follow-up: all five checks passed with no console/page errors.
- Existing browser E2E after the change: **37/37 PASS**, including error recovery and popup cleanup.
- The provider modal opened exactly one dialog and Escape reduced the dialog count to zero.
- No popup cascade was observed in the tested browser flow; the original problem was conflicting banners and dense chrome, now reduced in preview mode.
- Packaged Tauri/live DeepSeek onboarding remains unverified in this session because no staging or packaged target was available.
