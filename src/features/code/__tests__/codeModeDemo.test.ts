// codeModeDemo.test.ts — the Code Mode demo decomposition. Covers the bar's
// "demo-mode simulation works and is testable without a live engine":
//   * buildCodeModeTurn — deterministic program + tool calls from user input;
//   * decomposeProgram — one program → its individual tool calls (pure);
//   * applyRunEvent — the store reducer that produces the run's tool-call
//     decomposition from the demo event stream;
//   * MockIpcClient.prompt({profile:"code"}) — the Tauri demo shell path emits
//     run_code + tool_call/tool_result + run_complete events;
//   * simulateResponse(..., "code") — the browser-preview path publishes the
//     same run through the code-run bus and attaches the cards to the
//     transcript.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCodeModeTurn, decomposeProgram } from "../demoTurn";
import { applyRunEvent, type CodeRun } from "../useCodeRuns";
import { subscribeCodeRunEvents, type CodeRunEvent } from "../codeRunBus";
import { simulateResponse } from "../../chat/demo";
import type { TranscriptMessage } from "../../../ipc/contract";

// ---------------------------------------------------------------------------
// Deterministic program builder
// ---------------------------------------------------------------------------

describe("buildCodeModeTurn", () => {
  it("is deterministic — same input, byte-identical program and calls", () => {
    const a = buildCodeModeTurn("audit the release");
    const b = buildCodeModeTurn("audit the release");
    expect(b.program).toBe(a.program);
    expect(b.calls).toEqual(a.calls);
  });

  it("derives the program from the user's ACTUAL input", () => {
    const turn = buildCodeModeTurn("refactor auth module");
    expect(turn.program).toContain("refactor auth module");
    const other = buildCodeModeTurn("bake a cake");
    expect(other.program).not.toBe(turn.program);
  });

  it("produces a program with several SDK calls, one per decomposed tool call", () => {
    const { program, calls } = buildCodeModeTurn("hello");
    expect(calls.map((c) => c.name)).toEqual(["readFile", "searchFiles", "webSearch", "refine"]);
    expect(program).toContain("readFile({ path:");
    expect(decomposeProgram(program)).toHaveLength(calls.length);
  });

  it("labels every simulated output honestly", () => {
    const { calls } = buildCodeModeTurn("hello");
    const webSearch = calls.find((c) => c.name === "webSearch");
    expect(webSearch?.output).toMatch(/no live web search in demo mode/);
    for (const call of calls) expect(call.output.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Pure decomposition
// ---------------------------------------------------------------------------

describe("decomposeProgram", () => {
  it("splits one program into its individual tool calls with parsed inputs", () => {
    const { program } = buildCodeModeTurn("deploy");
    const calls = decomposeProgram(program);
    expect(calls).toHaveLength(4);
    expect(calls[0].name).toBe("readFile");
    expect(calls[0].input).toEqual({ path: "src/features/code/sdk.ts" });
    expect(calls[1].name).toBe("searchFiles");
    expect(calls[1].input).toEqual({ pattern: "run_code" });
  });

  it("degrades unparseable argument objects to their raw text", () => {
    const calls = decomposeProgram('await mystery({ nope: [} });');
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("mystery");
    expect(typeof calls[0].input).toBe("string");
  });

  it("returns an empty list for programs with no tool calls", () => {
    expect(decomposeProgram("const x = 1;")).toEqual([]);
    expect(decomposeProgram("")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Store reducer — the decomposition the UI shows
// ---------------------------------------------------------------------------

describe("applyRunEvent", () => {
  const session = "session-0";
  const base: CodeRunEvent = { type: "run_code", runId: "code-run-1", sessionId: session, program: "", ts: "2026-08-16T00:00:00.000Z" };

  function runEvent(): CodeRunEvent {
    const { program } = buildCodeModeTurn("ship it");
    return { type: "run_code", runId: base.runId, sessionId: session, program, ts: base.ts };
  }

  it("creates a run whose calls are seeded from the program decomposition", () => {
    const runs: CodeRun[] = [];
    const next = applyRunEvent(runs, runEvent());
    expect(next).toHaveLength(1);
    const run = next[0];
    expect(run.id).toBe("code-run-1");
    expect(run.status).toBe("running");
    expect(run.calls.map((c) => c.name)).toEqual(["readFile", "searchFiles", "webSearch", "refine"]);
    // Each seeded call carries its parsed input and starts running.
    expect(run.calls[0].input).toContain("src/features/code/sdk.ts");
    expect(run.calls.every((c) => c.status === "running")).toBe(true);
  });

  it("attaches tool results to the matching call and completes the run", () => {
    let runs: CodeRun[] = [];
    const event = runEvent();
    runs = applyRunEvent(runs, event);
    runs = applyRunEvent(runs, { type: "tool_result", runId: "code-run-1", sessionId: session, name: "readFile", output: "Read 31 lines.", ts: "t" });
    const readFile = runs[0].calls.find((c) => c.name === "readFile");
    expect(readFile?.status).toBe("complete");
    expect(readFile?.output).toBe("Read 31 lines.");
    // Unrelated calls stay running.
    expect(runs[0].calls.find((c) => c.name === "webSearch")?.status).toBe("running");
    runs = applyRunEvent(runs, { type: "run_complete", runId: "code-run-1", sessionId: session, ts: "t" });
    expect(runs[0].status).toBe("complete");
    expect(runs[0].calls.every((c) => c.status === "complete")).toBe(true);
  });

  it("appends tool_call events for names not in the seeded program", () => {
    let runs: CodeRun[] = [];
    runs = applyRunEvent(runs, runEvent());
    runs = applyRunEvent(runs, { type: "tool_call", runId: "code-run-1", sessionId: session, name: "extraTool", input: "{}", ts: "t" });
    expect(runs[0].calls.map((c) => c.name)).toContain("extraTool");
  });

  it("keeps two calls to the same tool as individual cards with their own results", () => {
    let runs: CodeRun[] = [];
    runs = applyRunEvent(runs, runEvent());
    // First readFile call (matches the running seed, updates its input).
    runs = applyRunEvent(runs, { type: "tool_call", runId: "code-run-1", sessionId: session, name: "readFile", input: '{"path":"a.ts"}', ts: "t" });
    runs = applyRunEvent(runs, { type: "tool_result", runId: "code-run-1", sessionId: session, name: "readFile", output: "content a", ts: "t" });
    // Second readFile call — the first is complete, so this is a NEW card.
    runs = applyRunEvent(runs, { type: "tool_call", runId: "code-run-1", sessionId: session, name: "readFile", input: '{"path":"b.ts"}', ts: "t" });
    runs = applyRunEvent(runs, { type: "tool_result", runId: "code-run-1", sessionId: session, name: "readFile", output: "content b", ts: "t" });
    const readFiles = runs[0].calls.filter((c) => c.name === "readFile");
    expect(readFiles).toHaveLength(2);
    expect(readFiles[0].input).toContain('"a.ts"');
    expect(readFiles[0].output).toBe("content a");
    expect(readFiles[1].input).toContain('"b.ts"');
    expect(readFiles[1].output).toBe("content b");
  });

  it("a tool_call heals a degraded seed with the event's real input", () => {
    let runs: CodeRun[] = [];
    // A program whose arg object isn't parseable (trailing comma) degrades the
    // seed to the raw argument text.
    const program = 'const c = await webSearch({ query: "x", });';
    runs = applyRunEvent(runs, { type: "run_code", runId: "code-run-1", sessionId: session, program, ts: "t" });
    expect(runs[0].calls[0].input).toBe('{ query: "x", }');
    // The tool_call event carries the real (parseable) input — it replaces the
    // degraded seed instead of leaving the partial text on the card.
    runs = applyRunEvent(runs, { type: "tool_call", runId: "code-run-1", sessionId: session, name: "webSearch", input: '{"query":"x"}', ts: "t" });
    expect(runs[0].calls[0].input).toBe('{"query":"x"}');
  });

  it("does not cross-contaminate runs of other sessions or ids", () => {
    let runs: CodeRun[] = [];
    runs = applyRunEvent(runs, runEvent());
    runs = applyRunEvent(runs, { type: "run_complete", runId: "code-run-other", sessionId: session, ts: "t" });
    expect(runs[0].status).toBe("running");
    runs = applyRunEvent(runs, { type: "tool_result", runId: "code-run-1", sessionId: "other-session", name: "readFile", output: "x", ts: "t" });
    expect(runs[0].calls.find((c) => c.name === "readFile")?.status).toBe("running");
  });
});

// ---------------------------------------------------------------------------
// Tauri demo shell path — MockIpcClient streams run_code events
// ---------------------------------------------------------------------------

describe("MockIpcClient code-mode prompt (Tauri demo shell path)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function freshClient(): Promise<{ client: import("../../../ipc/client").MockIpcClient; events: Array<Record<string, unknown>> }> {
    vi.resetModules();
    const mod = await import("../../../ipc/client");
    const client = mod.getIpcClient() as import("../../../ipc/client").MockIpcClient;
    const events: Array<Record<string, unknown>> = [];
    client.onEvent((e) => events.push(e as unknown as Record<string, unknown>));
    return { client, events };
  }

  it("streams run_code, per-call tool_call/tool_result, run_complete, then idle", async () => {
    const { client, events } = await freshClient();
    await client.prompt("hello", { profile: "code" });
    await vi.advanceTimersByTimeAsync(30000);

    const session = events.filter((e) => e.type === "session_event");
    const kinds = session.map((e) => (e.event as Record<string, unknown>).kind);
    expect(kinds).toContain("run_code");
    expect(kinds.filter((k) => k === "tool_call")).toHaveLength(4);
    expect(kinds.filter((k) => k === "tool_result")).toHaveLength(4);
    expect(kinds).toContain("run_complete");

    const runEvent = session.find((e) => (e.event as Record<string, unknown>).kind === "run_code");
    const program = (runEvent!.event as Record<string, unknown>).program as string;
    expect(program).toContain("Code Mode demo program");
    expect(decomposeProgram(program)).toHaveLength(4);

    // The final snapshot returns the queue to idle so busy clears.
    const snapshots = events.filter((e) => e.type === "snapshot");
    const idle = snapshots[snapshots.length - 1] as Record<string, unknown> | undefined;
    expect((idle?.state as Record<string, unknown> | undefined)?.queue).toEqual({ mode: "idle" });
  }, 15000);

  it("emits the same deterministic program for the same input", async () => {
    const a = await freshClient();
    await a.client.prompt("same goal", { profile: "code" });
    await vi.advanceTimersByTimeAsync(30000);
    const b = await freshClient();
    await b.client.prompt("same goal", { profile: "code" });
    await vi.advanceTimersByTimeAsync(30000);

    const programOf = (events: Array<Record<string, unknown>>) => {
      const run = events.find((e) => e.type === "session_event" && (e.event as Record<string, unknown>).kind === "run_code");
      return (run!.event as Record<string, unknown>).program as string;
    };
    expect(programOf(b.events)).toBe(programOf(a.events));
  });
});

// ---------------------------------------------------------------------------
// Browser-preview path — simulateResponse publishes the run to the bus
// ---------------------------------------------------------------------------

describe("simulateResponse code mode (browser preview path)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("publishes the full run to the code-run bus and attaches the tool-call cards", () => {
    const busEvents: CodeRunEvent[] = [];
    const off = subscribeCodeRunEvents((e) => busEvents.push(e));

    let msgs: TranscriptMessage[] = [];
    let done = 0;
    const cleanup = simulateResponse(
      "ship the release",
      {
        onUpdate: (u) => {
          msgs = u(msgs);
        },
        onDone: () => {
          done += 1;
        },
      },
      "code",
    );
    vi.advanceTimersByTime(30000);

    // Bus: run_code → 4 tool_call → 4 tool_result → run_complete.
    expect(busEvents[0].type).toBe("run_code");
    expect(busEvents.filter((e) => e.type === "tool_call")).toHaveLength(4);
    expect(busEvents.filter((e) => e.type === "tool_result")).toHaveLength(4);
    expect(busEvents[busEvents.length - 1]?.type).toBe("run_complete");

    // Transcript: the assistant message carries the decomposed tool calls.
    expect(done).toBe(1);
    const assistant = msgs[0];
    expect(assistant.status).toBe("complete");
    expect(assistant.toolCalls).toHaveLength(4);
    expect(assistant.toolCalls!.map((c) => c.name)).toEqual(["readFile", "searchFiles", "webSearch", "refine"]);
    expect(assistant.toolCalls!.every((c) => c.status === "complete")).toBe(true);
    expect(assistant.content).toMatch(/simulated/);

    cleanup();
    off();
  });

  it("uses the deterministic program for the bus run_code event", () => {
    const busEvents: CodeRunEvent[] = [];
    const off = subscribeCodeRunEvents((e) => busEvents.push(e));
    let msgs: TranscriptMessage[] = [];
    const cleanup = simulateResponse("deterministic goal", { onUpdate: (u) => { msgs = u(msgs); }, onDone: () => {} }, "code");
    vi.advanceTimersByTime(30000);
    const run = busEvents.find((e) => e.type === "run_code");
    expect(run?.type === "run_code" ? run.program : "").toBe(buildCodeModeTurn("deterministic goal").program);
    cleanup();
    off();
  });
});
