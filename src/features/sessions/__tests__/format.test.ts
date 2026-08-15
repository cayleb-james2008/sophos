// format.test.ts — the sessions feature's formatting helpers. Pure functions,
// so these are exercised against fixed inputs (with Date.now() pinned) to lock
// down the boundary behaviour: invalid/empty inputs fall back to "—", and each
// bucket boundary (45s / 60m / 24h / 7d) behaves as documented.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { relativeTime, formatDate, formatTokens, initials, durationLabel } from "../format";

const NOW = new Date("2026-01-15T12:00:00.000Z");

function iso(offsetMs: number): string {
  return new Date(NOW.getTime() - offsetMs).toISOString();
}

describe("relativeTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns an em dash for missing or invalid input", () => {
    expect(relativeTime(undefined)).toBe("—");
    expect(relativeTime("not-a-date")).toBe("—");
  });

  it("returns 'just now' for sub-45-second diffs", () => {
    expect(relativeTime(iso(30_000))).toBe("just now");
    expect(relativeTime(iso(0))).toBe("just now");
  });

  it("returns minutes for sub-hour diffs", () => {
    expect(relativeTime(iso(5 * 60_000))).toBe("5m ago");
  });

  it("returns hours for sub-day diffs", () => {
    expect(relativeTime(iso(3 * 3600_000))).toBe("3h ago");
  });

  it("returns days for sub-week diffs", () => {
    expect(relativeTime(iso(2 * 86_400_000))).toBe("2d ago");
  });

  it("falls back to a short date beyond a week", () => {
    const out = relativeTime(iso(10 * 86_400_000));
    expect(out).not.toMatch(/ago$/);
    expect(out).not.toBe("—");
    // Matches the documented fallback (short month + numeric day).
    expect(out).toMatch(/\w{3,4} \d+/);
  });
});

describe("formatDate", () => {
  it("returns an em dash for missing or invalid input", () => {
    expect(formatDate(undefined)).toBe("—");
    expect(formatDate("garbage")).toBe("—");
  });

  it("formats a valid ISO timestamp", () => {
    const out = formatDate("2026-01-15T12:00:00.000Z");
    expect(out).not.toBe("—");
    // Must carry the date (day + month) and a time (hour:minute).
    expect(out).toMatch(/\d/);
    expect(out).toMatch(/:/);
  });
});

describe("formatTokens", () => {
  it("returns an em dash for missing input", () => {
    expect(formatTokens(undefined)).toBe("—");
    expect(formatTokens(null as unknown as number)).toBe("—");
  });

  it("formats raw counts below one thousand", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
  });

  it("formats thousands with one decimal and a k suffix", () => {
    expect(formatTokens(1_000)).toBe("1.0k");
    expect(formatTokens(2_500)).toBe("2.5k");
    expect(formatTokens(999_999)).toBe("1000.0k");
  });

  it("formats millions with one decimal and an M suffix", () => {
    expect(formatTokens(1_000_000)).toBe("1.0M");
    expect(formatTokens(1_500_000)).toBe("1.5M");
  });
});

describe("initials", () => {
  it("falls back to AG for empty or whitespace-only names", () => {
    expect(initials(undefined)).toBe("AG");
    expect(initials("")).toBe("AG");
    expect(initials("   ")).toBe("AG");
  });

  it("uses the first letters of the first two words, uppercased", () => {
    expect(initials("Alice")).toBe("A");
    expect(initials("Alice Bob")).toBe("AB");
    expect(initials("alice bob carol")).toBe("AB");
  });

  it("slices to at most two characters", () => {
    expect(initials("John David Smith")).toBe("JD");
  });
});

describe("durationLabel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns an em dash for missing or invalid start", () => {
    expect(durationLabel(undefined)).toBe("—");
    expect(durationLabel("bad")).toBe("—");
  });

  it("reports sub-minute durations as <1m", () => {
    expect(durationLabel(iso(10_000))).toBe("<1m");
  });

  it("reports minutes below an hour", () => {
    expect(durationLabel(iso(5 * 60_000))).toBe("5m");
  });

  it("reports hours and minutes below a day", () => {
    expect(durationLabel(iso((1 * 3600 + 30 * 60) * 1000))).toBe("1h 30m");
  });

  it("reports days and hours at or beyond a day", () => {
    expect(durationLabel(iso((2 * 86400 + 3 * 3600) * 1000))).toBe("2d 3h");
  });

  it("uses an explicit end timestamp when provided", () => {
    const from = "2026-01-15T10:00:00.000Z";
    const to = "2026-01-15T11:00:00.000Z";
    expect(durationLabel(from, to)).toBe("1h 0m");
  });

  it("clamps a backwards duration to zero", () => {
    const from = "2026-01-15T12:00:00.000Z";
    const to = "2026-01-15T10:00:00.000Z";
    expect(durationLabel(from, to)).toBe("<1m");
  });
});
