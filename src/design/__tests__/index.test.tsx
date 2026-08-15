// index.test.tsx — the design-system barrel. It re-exports primitives,
// overlays, motion helpers, tokens, and theme. This test verifies the barrel
// wiring stays intact so feature modules can import the whole surface from
// a single path.

import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  tokens,
  applyTheme,
  resolveTheme,
  Text,
  Button,
  Fade,
  ShortcutsOverlay,
} from "@/design";

function mockMatchMedia(matches: boolean) {
  const mql = {
    matches,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockReturnValue(mql),
  });
}

beforeEach(() => mockMatchMedia(false));

describe("design barrel", () => {
  it("re-exports the token object", () => {
    expect(tokens.layout.sidebarW).toBe("232px");
    expect(tokens.color.accent).toContain("--pa-green");
  });

  it("re-exports theme helpers", () => {
    expect(typeof applyTheme).toBe("function");
    expect(resolveTheme("dark")).toBe("dark");
  });

  it("re-exports usable core components", () => {
    render(
      <div>
        <Text>Barrel text</Text>
        <Button>Barrel button</Button>
      </div>,
    );
    expect(screen.getByText("Barrel text")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Barrel button" })).toBeInTheDocument();
  });

  it("re-exports the motion layer", () => {
    const { container } = render(<Fade>animated</Fade>);
    expect(container.firstChild).toHaveClass("pa-fade");
  });

  it("re-exports the ShortcutsOverlay component type", () => {
    expect(typeof ShortcutsOverlay).toBe("function");
  });
});
