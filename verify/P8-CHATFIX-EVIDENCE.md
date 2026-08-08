# P8 — Chat demo-mode fix: evidence

## What changed

The browser-preview chat (no Tauri) previously ran the leftover stub in
`src/features/chat/demo.ts`:
- `demoSeed()` seeded a canned **market-analysis** conversation (regime read, VIX, breadth, "signal_check").
- `simulateResponse(_userText, …)` **ignored** the user's input and streamed a hardcoded trading-analysis reply (`THINKING_CHUNKS` / `ANSWER_CHUNKS` / `TOOL_CALLS` with "trend: confirmed", "confidence: 0.68").

Typing "hey there" produced a nonsensical market-analysis reply.

### Fixes (all confined to the browser `MockIpcClient` / demo path)

| File | Change |
|------|--------|
| `src/features/chat/demo.ts` | `demoSeed()` → neutral welcome (system note + generic assistant greeting). `simulateResponse(userText, …)` now derives thinking + answer + tool call from the **user's actual input**: it echoes "You said: …", acknowledges the message, explains it's a demo preview without a live engine, and shows a clearly-labeled `demo_echo` tool call. **No fake market/technical/signal data.** |
| `src/ipc/client.ts` | `MockIpcClient.getTranscript()` returns `[]` so `useChat` seeds the neutral `demoSeed()` instead of a stale canned "auth refactor" exchange. Added exported `isTauri` flag (same detection as before). **`TauriIpcClient` untouched.** |
| `src/features/chat/useChat.ts` | Uses the shared `isTauri` export instead of a duplicate local const. Demo path logic otherwise unchanged. |
| `src/features/chat/ChatView.tsx` | Added a visible **"Demo mode — engine not connected"** banner (amber chip) shown only in the browser preview, so simulated output can't be mistaken for real assistant output. |

## Build

`npm run build` (tsc + vite) — **clean**, 0 errors.

## Browser smoke (`npm run dev`, port 1420 occupied by sibling worktree → used 1510)

Loaded the app on the Chat view and sent three inputs. Every simulated reply
referenced the **actual input** and never produced trading data.

| Input | Reply echoed |
|-------|--------------|
| `hey there` | `Got it — you said: “hey there”. …` (demo_echo, 9 chars) |
| `can you help me summarize my notes?` | `Got it — you said: “can you help me summarize my notes?”. …` (35 chars) |
| `tell me about yourself` | `Got it — you said: “tell me about yourself”. …` (22 chars) |

Each turn shows: simulated **THINKING**, an honest **demo_echo** tool call
(input = user text, output = "Demo: echoed user input … no live tool is
available in the browser preview"), and a friendly acknowledgment — no
`signal_check` / `trend: confirmed` / `confidence` anywhere.

Initial load shows the **"Demo mode — engine not connected"** banner and the
neutral welcome seed (no canned market conversation).

### Screenshots (this worktree `verify/`)
- `verify/01_hey_there.png` — "hey there" → echoed reply + demo_echo + thinking.
- `verify/02_summarize_notes.png` — longer input echoed.
- `verify/03_about_self.png` — third input echoed.

(DOM text extraction used alongside screenshots because the review model is not
image-capable; the transcript text above is the authoritative verification.)

## Scope / preservation
- Real chat IPC (`TauriIpcClient`), all other views/features untouched.
- Browser demo path only.
