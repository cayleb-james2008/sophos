// tokens.test.ts — the design token surface. Color tokens are CSS custom-
// property indirection (theme-switchable at the DOM layer); non-color tokens
// are literal. We assert the stable contract: required keys exist, aliases
// agree with their canonical name, and literals have the expected values.

import { describe, it, expect } from "vitest";
import { tokens } from "../tokens";

describe("tokens.color", () => {
  it("exposes the core surface tokens", () => {
    expect(tokens.color.bg).toBe("var(--pa-ink)");
    expect(tokens.color.surface).toBe("var(--pa-card)");
    expect(tokens.color.line).toBe("var(--pa-border)");
    expect(tokens.color.text).toBe("var(--pa-paper)");
    expect(tokens.color.accent).toBe("var(--pa-green)");
  });

  it("keeps alias keys consistent with their canonical names", () => {
    expect(tokens.color.surface).toBe(tokens.color.bgElevated);
    expect(tokens.color.surface2).toBe(tokens.color.bgRaised);
    expect(tokens.color.line).toBe(tokens.color.border);
    expect(tokens.color.muted).toBe(tokens.color.textMuted);
    expect(tokens.color.ok).toBe(tokens.color.success);
    expect(tokens.color.warn).toBe(tokens.color.warning);
    expect(tokens.color.danger).toBe(tokens.color.err);
  });

  it("uses the terminal-green accent family", () => {
    expect(tokens.color.accent).toContain("--pa-green");
    expect(tokens.color.accentHover).toContain("--pa-green-hover");
    expect(tokens.color.accentSoft).toContain("--pa-green-soft");
  });

  it("keeps primary-button text literal in both themes", () => {
    expect(tokens.color.textInverse).toBe("#0e0e0e");
  });
});

describe("tokens.font", () => {
  it("declares a display, sans, and mono family", () => {
    expect(tokens.font.sans).toContain("Geist");
    expect(tokens.font.mono).toContain("Geist Mono");
    expect(tokens.font.display).toContain("Geist");
  });

  it("sizes scale from xs to 3xl and weights are numeric", () => {
    expect(tokens.font.size.xs).toBe("11px");
    expect(tokens.font.size["3xl"]).toBe("31px");
    expect(tokens.font.weight.bold).toBe(700);
    expect(tokens.font.weight.regular).toBe(400);
  });
});

describe("tokens.space / radius / motion / shadow / layout", () => {
  it("provides tight instrument-like spacing", () => {
    expect(tokens.space.xs).toBe("4px");
    expect(tokens.space.xl).toBe("22px");
  });

  it("is sharp-cornered (hairline, no rounding) except pill full", () => {
    expect(tokens.radius.sm).toBe("0px");
    expect(tokens.radius.lg).toBe("0px");
    expect(tokens.radius.full).toBe("9999px");
  });

  it("defines deliberate motion timing", () => {
    expect(tokens.motion.fast).toBe("100ms");
    expect(tokens.motion.base).toBe("180ms");
    expect(tokens.motion.slow).toBe("300ms");
  });

  it("renders flat shadows with a green glow ring", () => {
    expect(tokens.shadow.sm).toBe("none");
    expect(tokens.shadow.glow).toContain("rgba(133,237,117");
  });

  it("declares the shell layout dimensions", () => {
    expect(tokens.layout.sidebarW).toBe("232px");
    expect(tokens.layout.headerH).toBe("48px");
  });
});
