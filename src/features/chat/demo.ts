// demo — browser-preview seed and a simulated streaming response.
//
// In the browser (no Tauri) the MockIpcClient returns an empty transcript and
// prompt() only emits a bare user_message event — there is no real daemon to
// stream from. To keep the chat demonstrable in the dev preview, this module
// seeds a neutral, clearly-labeled demo conversation and simulates a streaming
// assistant turn (thinking → optional tool call → answer) that responds to the
// user's ACTUAL input. In Tauri this module is never used: real IPC events drive
// the UI.

import type { TranscriptMessage, ToolCall } from "../../ipc/contract";

const now = Date.now();
const iso = (secAgo: number) => new Date(now - secAgo * 1000).toISOString();

// ---------------------------------------------------------------------------
// Large-transcript seed — for exercising the windowed MessageList in the
// browser preview. Generates `count` messages with a realistic mix of roles,
// some with thinking blocks and tool calls (variable row heights), so the
// virtualization + auto-stick behavior is demonstrable at 500+ messages.
// ---------------------------------------------------------------------------

export function demoSeedLarge(count = 500): TranscriptMessage[] {
  const msgs: TranscriptMessage[] = [];
  const now = Date.now();
  const roles: TranscriptMessage["role"][] = ["user", "assistant", "assistant", "system", "tool"];
  const samples = [
    "Refactor the auth module to use the new token store.",
    "Review the endpoint contracts and flag any drift.",
    "Migrate the config schema to the v2 format.",
    "Add a retry with exponential backoff to the daemon bridge.",
    "Summarize the session and propose the next steps.",
    "Check the context usage and suggest a compaction.",
    "Wire the new provider profile into the model selector.",
    "Investigate the slow transcript render and fix it.",
    "Draft a release note for the 0.1.0 milestone.",
    "Verify the build is green and the e2e suite passes.",
  ];
  for (let i = 0; i < count; i++) {
    const role = roles[i % roles.length];
    const base = samples[i % samples.length];
    const id = `perf-${i}`;
    const ts = new Date(now - (count - i) * 4000).toISOString();
    if (role === "user") {
      msgs.push({ id, role, content: `${base} (message ${i})`, timestamp: ts, status: "complete" });
    } else if (role === "assistant") {
      msgs.push({
        id,
        role,
        content: `Here's the result for message ${i}: ${base}. I've completed the analysis and the next step is to verify the output against the spec before moving on.`,
        thinking: i % 3 === 0 ? `Thinking about ${base}…` : undefined,
        toolCalls:
          i % 4 === 0
            ? [
                {
                  id: `tc-${i}`,
                  name: "read_file",
                  input: JSON.stringify({ path: "src/features/chat/demo.ts" }),
                  output: "Read 42 lines.",
                  status: "complete" as const,
                },
              ]
            : undefined,
        timestamp: ts,
        status: "complete",
      });
    } else if (role === "system") {
      msgs.push({ id, role, content: `System checkpoint ${i}`, timestamp: ts, status: "complete" });
    } else {
      msgs.push({ id, role, content: `Tool output for step ${i}`, timestamp: ts, status: "complete" });
    }
  }
  return msgs;
}

export function demoSeed(): TranscriptMessage[] {
  return [
    {
      id: "demo-sys-1",
      role: "system",
      content: "Demo preview · simulated responses — the live assistant engine is not connected",
      timestamp: iso(3600),
      status: "complete",
    },
    {
      id: "demo-assistant-1",
      role: "assistant",
      content:
        "Welcome! This is a browser preview with simulated responses — no live engine is connected, so replies here are generated for demonstration only and don't reflect real tools or data.\n\nGo ahead and type a message, and I'll respond to what you actually say.",
      timestamp: iso(3500),
      status: "complete",
    },
  ];
}

// ---------------------------------------------------------------------------
// Simulated streaming turn
// ---------------------------------------------------------------------------

// Truncate long user messages so echoing them stays readable.
function shortText(text: string, max = 140): string {
  const t = text.trim();
  if (!t) return "(empty message)";
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export interface SimCallbacks {
  onUpdate: (updater: (msgs: TranscriptMessage[]) => TranscriptMessage[]) => void;
  onDone: () => void;
}

/** Start a simulated assistant turn that echoes the user's actual input. */
export function simulateResponse(userText: string, cb: SimCallbacks): () => void {
  const timers: number[] = [];
  const push = (fn: () => void, ms: number) => {
    timers.push(window.setTimeout(fn, ms));
  };

  const shown = shortText(userText);
  const assistantId = `sim-${Date.now()}`;

  // Content is derived from the user's real input — no canned trading analysis.
  const thinkingChunks = [
    "Let me read your message carefully.",
    `You wrote: “${shown}”.`,
    "I'll respond directly to what you said — no fabricated data or guesses.",
  ];
  const answerChunks = [
    `Got it — you said: “${shown}”.`,
    "\n\nThanks for your message. This is a demo preview without a live engine, so I can't run real tools or fetch live data here.",
    "\n\nBut I understood what you're asking. In the connected app I'd help you work through it step by step — tell me more and I'll keep building on your message.",
  ];
  // A clearly-labeled, honest demo tool call that echoes the input — it
  // demonstrates the tool-call UI without pretending to access a real tool.
  const demoToolCall: ToolCall = {
    id: "demo-sim-tc-1",
    name: "demo_echo",
    input: JSON.stringify({ text: userText.trim() }),
    output: `Demo: echoed user input (${userText.trim().length} chars) — no live tool is available in the browser preview.`,
    status: "complete",
  };

  // A realistic file-edit tool call so the unified diff renderer is
  // demonstrable in the browser preview. The old_string/new_string shape is
  // what the diff detection recognizes.
  const demoEditCall: ToolCall = {
    id: "demo-sim-tc-2",
    name: "edit_file",
    input: JSON.stringify({
      file_path: "src/features/chat/demo.ts",
      old_string: "// Truncate long user messages so echoing them stays readable.",
      new_string:
        "// Truncate long user messages so they stay readable.\n// (demo edit — shows the unified diff renderer)",
    }),
    output: "Edited src/features/chat/demo.ts — 2 insertions, 1 deletion.",
    status: "complete",
  };

  // 1. Create the streaming assistant message with thinking.
  cb.onUpdate((msgs) => [
    ...msgs,
    {
      id: assistantId,
      role: "assistant",
      content: "",
      thinking: "",
      toolCalls: [],
      status: "streaming",
      timestamp: new Date().toISOString(),
    },
  ]);

  // 2. Stream thinking.
  thinkingChunks.forEach((chunk, i) => {
    push(() => {
      cb.onUpdate((msgs) =>
        msgs.map((m) =>
          m.id === assistantId
            ? { ...m, thinking: `${m.thinking ?? ""}${i > 0 ? " " : ""}${chunk}` }
            : m,
        ),
      );
    }, 500 + i * 700);
  });

  // 3. Add running tool calls, then complete them.
  push(() => {
    cb.onUpdate((msgs) =>
      msgs.map((m) =>
        m.id === assistantId
          ? {
              ...m,
              toolCalls: [
                { ...demoToolCall, status: "running" },
                { ...demoEditCall, status: "running" },
              ],
            }
          : m,
      ),
    );
  }, 500 + thinkingChunks.length * 700);

  push(() => {
    cb.onUpdate((msgs) =>
      msgs.map((m) =>
        m.id === assistantId
          ? { ...m, toolCalls: [demoToolCall, demoEditCall] }
          : m,
      ),
    );
  }, 500 + thinkingChunks.length * 700 + 1600);

  // 4. Stream the answer.
  let acc = "";
  answerChunks.forEach((chunk, i) => {
    push(() => {
      acc += chunk;
      cb.onUpdate((msgs) =>
        msgs.map((m) => (m.id === assistantId ? { ...m, content: acc } : m)),
      );
    }, 500 + thinkingChunks.length * 700 + 1600 + 400 + i * 500);
  });

  // 5. Mark complete.
  push(() => {
    cb.onUpdate((msgs) =>
      msgs.map((m) => (m.id === assistantId ? { ...m, status: "complete" } : m)),
    );
    cb.onDone();
  }, 500 + thinkingChunks.length * 700 + 1600 + 400 + answerChunks.length * 500 + 300);

  return () => {
    timers.forEach((t) => window.clearTimeout(t));
  };
}
