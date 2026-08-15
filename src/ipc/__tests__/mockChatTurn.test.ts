import { describe, it, expect } from "vitest";
import { MockIpcClient } from "../client";

function turnEvents(events: any[]) {
  return events.filter((e) => e.type === "session_event" && e.event && e.event.kind !== "side_question_event");
}

describe("MockIpcClient demo chat turn", () => {
  it(
    "emits user_message, streams an assistant turn, and ends with a queue-idle snapshot",
    async () => {
      const client = new MockIpcClient();
      const events: any[] = [];
      client.onEvent((e: any) => events.push(e));
      client.prompt("hello world").catch(() => {});

      // The simulated turn takes ~8s (real timers); wait past the final snapshot.
      await new Promise((r) => setTimeout(r, 9500));

      const kinds = turnEvents(events).map((e) => e.event.kind);
      expect(kinds[0]).toBe("user_message");
      expect(kinds).toContain("thinking_delta");
      expect(kinds).toContain("tool_call");
      expect(kinds).toContain("tool_result");
      expect(kinds.filter((k) => k === "text").length).toBeGreaterThanOrEqual(1);

      // The final snapshot marks the queue idle so the composer clears busy.
      const snapshots = events.filter((e) => e.type === "snapshot");
      const last = snapshots[snapshots.length - 1];
      expect(last).toBeDefined();
      expect(last.state.queue).toEqual({ mode: "idle" });

      // Also: the turn starts with a busy-mode snapshot so the idle transition
      // fires on every turn (busy-clearing effect).
      const busySnap = snapshots.find((e) => e.state && e.state.queue && e.state.queue.mode === "busy");
      expect(busySnap).toBeDefined();
    },
    15000,
  );

  it(
    "abort() stops further turn events (only the connect snapshot may fire)",
    async () => {
      const client = new MockIpcClient();
      const events: any[] = [];
      client.onEvent((e: any) => events.push(e));
      client.prompt("start").catch(() => {});
      await new Promise((r) => setTimeout(r, 200));
      client.abort().catch(() => {});

      const countAtAbort = turnEvents(events).length;
      await new Promise((r) => setTimeout(r, 2000));
      // No new turn (thinking/tool/text) events should fire after abort.
      expect(turnEvents(events).length).toBe(countAtAbort);
    },
    10000,
  );
});
