// demo — browser-preview seed and simulated streaming turn. Uses fake timers
// to drive the simulated assistant response deterministically and verify the
// echoed content, the honest tool calls, and the final "complete" state.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoSeed, demoSeedLarge, simulateResponse } from "../demo";
import type { TranscriptMessage } from "../../../ipc/contract";

describe("demoSeed", () => {
  it("returns a system banner plus a welcoming assistant message", () => {
    const msgs = demoSeed();
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("system");
    expect(msgs[1].role).toBe("assistant");
    expect(msgs[0].content).toMatch(/Demo preview/i);
  });
});

describe("demoSeedLarge", () => {
  it("generates the requested number of messages", () => {
    expect(demoSeedLarge(10)).toHaveLength(10);
  });

  it("defaults to 500 messages", () => {
    expect(demoSeedLarge()).toHaveLength(500);
  });

  it("mixes roles and assigns ascending timestamps", () => {
    const msgs = demoSeedLarge(20);
    const roles = new Set(msgs.map((m) => m.role));
    expect(roles.has("user")).toBe(true);
    expect(roles.has("assistant")).toBe(true);
    expect(roles.has("system")).toBe(true);
    expect(roles.has("tool")).toBe(true);
    const ts = msgs.map((m) => new Date(m.timestamp!).getTime());
    for (let i = 1; i < ts.length; i++) expect(ts[i]).toBeGreaterThanOrEqual(ts[i - 1]);
  });

  it("attaches a tool call to a subset of assistant messages", () => {
    const msgs = demoSeedLarge(20);
    const withTool = msgs.find((m) => m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0);
    expect(withTool).toBeDefined();
    expect(withTool!.toolCalls![0].name).toBe("read_file");
  });
});

describe("simulateResponse", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function runSim(userText: string) {
    let msgs: TranscriptMessage[] = [];
    let done = 0;
    const cleanup = simulateResponse(userText, {
      onUpdate: (u) => {
        msgs = u(msgs);
      },
      onDone: () => {
        done += 1;
      },
    });
    return { cleanup, get: () => ({ msgs: [...msgs], done }) };
  }

  it("creates a streaming assistant message synchronously", () => {
    const { get } = runSim("hello");
    const { msgs, done } = get();
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe("assistant");
    expect(msgs[0].status).toBe("streaming");
    expect(done).toBe(0);
  });

  it("streams thinking, tool calls, and an answer, then marks complete", () => {
    const { cleanup, get } = runSim("refactor the module");
    vi.advanceTimersByTime(10000);
    const { msgs, done } = get();
    expect(done).toBe(1);
    expect(msgs[0].status).toBe("complete");
    // Content echoes the user's actual input.
    expect(msgs[0].content).toContain("refactor the module");
    // Thinking was streamed.
    expect(msgs[0].thinking).toContain("Let me read your message carefully.");
    // Two honest demo tool calls: the echo and the file edit.
    expect(msgs[0].toolCalls).toHaveLength(2);
    expect(msgs[0].toolCalls![0].name).toBe("demo_echo");
    expect(msgs[0].toolCalls![1].name).toBe("edit_file");
    cleanup();
  });

  it("returns a cleanup that cancels the pending timers", () => {
    let msgs: TranscriptMessage[] = [];
    let done = 0;
    const cleanup = simulateResponse("hi", {
      onUpdate: (u) => {
        msgs = u(msgs);
      },
      onDone: () => {
        done += 1;
      },
    });
    cleanup();
    vi.advanceTimersByTime(10000);
    // Nothing more fires after cleanup: the message never completes and onDone
    // is never called.
    expect(done).toBe(0);
    expect(msgs[0].status).toBe("streaming");
    expect(msgs[0].content).toBe("");
  });

  it("labels empty input honestly", () => {
    const { cleanup, get } = runSim("   ");
    vi.advanceTimersByTime(10000);
    expect(get().msgs[0].content).toContain("(empty message)");
    cleanup();
  });

  it("truncates very long input in the echoed content", () => {
    const long = "x".repeat(300);
    const { cleanup, get } = runSim(long);
    vi.advanceTimersByTime(10000);
    expect(get().msgs[0].content).toContain("…");
    cleanup();
  });
});
