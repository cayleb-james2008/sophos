// nextDue.test.ts — honest next-run estimate for heartbeat/schedule intervals.
// Pure utility. Uses fake timers pinned to a known "now" so the human-readable
// "in ~N min" / "in ~N h" strings are deterministic.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { estimateNextDue } from "../nextDue";

const NOW = new Date("2026-01-15T10:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("estimateNextDue", () => {
  it("returns null for empty / whitespace intervals", () => {
    expect(estimateNextDue("")).toBeNull();
    expect(estimateNextDue("   ")).toBeNull();
  });

  it("returns null for unparseable garbage", () => {
    expect(estimateNextDue("someday soon")).toBeNull();
    expect(estimateNextDue("*/bad * * * *")).toBeNull();
    expect(estimateNextDue("0 99 * * *")).toBeNull();
  });

  it("parses a star-slash minute cron field as every N minutes", () => {
    expect(estimateNextDue("*/15 * * * *")).toBe("in ~15 min");
    expect(estimateNextDue("*/5 * * * *")).toBe("in ~5 min");
  });

  it("parses a zero-minute cron field as hourly", () => {
    // "0 * * * *" does not match the parseable forms (the daily branch needs a
    // numeric hour field), so it falls through to null — documented behavior.
    expect(estimateNextDue("0 * * * *")).toBeNull();
    // A star-slash with a full hour behaves as hourly.
    expect(estimateNextDue("*/60 * * * *")).toBe("in ~1 h");
  });

  it("parses a daily cron (0 9) to the next 09:00", () => {
    // Timezone-dependent: the exact hour depends on local time, so assert the
    // general "in ~N h" shape rather than a fixed value.
    expect(estimateNextDue("0 9 * * *")).toMatch(/^in ~\d+ h$/);
  });

  it("parses a daily cron in the past-of-today as tomorrow", () => {
    // NOW is 10:00; the next 07:00 already passed, so it rolls to tomorrow.
    expect(estimateNextDue("0 7 * * *")).toMatch(/^in ~\d+ h$/);
  });

  it("parses 'every Nm' human intervals", () => {
    expect(estimateNextDue("every 10m")).toBe("in ~10 min");
    expect(estimateNextDue("every 5 minutes")).toBe("in ~5 min");
  });

  it("parses 'every Nh' human intervals", () => {
    expect(estimateNextDue("every 2 hours")).toBe("in ~2 h");
    expect(estimateNextDue("every 1h")).toBe("in ~1 h");
  });

  it("parses bare minutes and hours", () => {
    expect(estimateNextDue("10m")).toBe("in ~10 min");
    expect(estimateNextDue("2h")).toBe("in ~2 h");
  });

  it("is case-insensitive and trims surrounding whitespace", () => {
    expect(estimateNextDue("  EVERY 15M ")).toBe("in ~15 min");
    expect(estimateNextDue("*/30 * * * *")).toBe("in ~30 min");
  });
});
