// theme.test.ts — shared graph status->color theming. Covers the status-color
// mapping, the soft-wash variant, and unknown-status fallbacks.

import { describe, expect, it } from "vitest";
import { tokens } from "../../../design/tokens";
import { statusColor, statusWash, ACCENT, LINE, MUTED } from "../theme";

describe("statusColor", () => {
  it("maps ok / live / running statuses to the ok token", () => {
    for (const s of ["running", "connected", "active", "live", "ok", "success", "daemon_alive"]) {
      expect(statusColor(s)).toBe(tokens.color.ok);
    }
  });

  it("maps warn-ish statuses to the warn token", () => {
    for (const s of ["warn", "connecting", "reconnecting", "paused"]) {
      expect(statusColor(s)).toBe(tokens.color.warn);
    }
  });

  it("maps err / offline statuses to the err token", () => {
    for (const s of ["err", "error", "disconnected", "failed", "offline"]) {
      expect(statusColor(s)).toBe(tokens.color.err);
    }
  });

  it("maps neutral / terminal statuses to textDim", () => {
    for (const s of ["saved", "done", "idle", "background"]) {
      expect(statusColor(s)).toBe(tokens.color.textDim);
    }
  });

  it("falls back to textDim for unknown or empty statuses", () => {
    expect(statusColor("mystery-state")).toBe(tokens.color.textDim);
    expect(statusColor(undefined)).toBe(tokens.color.textDim);
    expect(statusColor("")).toBe(tokens.color.textDim);
  });
});

describe("statusWash", () => {
  it("returns the soft green for live statuses", () => {
    expect(statusWash("running")).toBe("var(--pa-green-soft)");
    expect(statusWash("connected")).toBe("var(--pa-green-soft)");
    expect(statusWash("ok")).toBe("var(--pa-green-soft)");
  });

  it("returns the soft amber for warn statuses", () => {
    expect(statusWash("connecting")).toBe("var(--pa-amber-soft)");
    expect(statusWash("paused")).toBe("var(--pa-amber-soft)");
  });

  it("returns the soft danger for error statuses", () => {
    expect(statusWash("error")).toBe("var(--pa-danger-soft)");
    expect(statusWash("disconnected")).toBe("var(--pa-danger-soft)");
  });

  it("returns the paper-dim wash for neutral / unknown statuses", () => {
    expect(statusWash("idle")).toBe("var(--pa-paper-dim)");
    expect(statusWash(undefined)).toBe("var(--pa-paper-dim)");
  });
});

describe("theme constants", () => {
  it("re-exports the token-derived constants", () => {
    expect(ACCENT).toBe(tokens.color.accent);
    expect(LINE).toBe(tokens.color.line);
    expect(MUTED).toBe(tokens.color.textMuted);
  });
});
