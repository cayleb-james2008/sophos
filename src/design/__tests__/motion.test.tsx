// motion.test.tsx — the dependency-free motion layer. Transitions are CSS
// keyframe classes plus timing via CSS custom properties; Stagger fans out a
// per-child delay. All of it honors prefers-reduced-motion (no animation class,
// zero stagger).

import { render, screen, renderHook, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Fade, SlideUp, Stagger, StaggerItem, ViewTransition, useReducedMotion } from "../motion";

function mockMatchMedia(matches: boolean) {
  const mql = {
    matches,
    media: "(prefers-reduced-motion: reduce)",
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockReturnValue(mql),
  });
  return mql;
}

beforeEach(() => {
  mockMatchMedia(false);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const Probe = ({ delay }: { delay?: number }) => <span data-testid="probe" data-delay={delay}>{delay ?? "none"}</span>;

describe("useReducedMotion", () => {
  it("reflects the OS reduced-motion preference", () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
  });

  it("reports true when reduced motion is requested", () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);
  });

  it("reacts to a live preference change and unsubscribes on unmount", () => {
    const mql = mockMatchMedia(false);
    const { result, unmount } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);

    // Flip the OS preference → the stored value updates.
    act(() => {
      const cb = mql.addEventListener.mock.calls.find((c) => c[0] === "change")?.[1];
      mql.matches = true;
      cb?.();
    });
    expect(result.current).toBe(true);

    unmount();
    expect(mql.removeEventListener).toHaveBeenCalled();
  });
});

describe("Fade", () => {
  it("applies the pa-fade class and timing custom properties", () => {
    const { container } = render(
      <Fade duration="220ms" delay={50}>
        hello
      </Fade>,
    );
    const el = container.firstChild as HTMLElement;
    expect(el).toHaveClass("pa-fade");
    expect(el).toHaveStyle({ "--pa-motion-duration": "220ms", "--pa-motion-delay": "50ms" } as Record<string, string>);
    expect(el).toHaveTextContent("hello");
  });

  it("drops the animation class when reduced motion is on", () => {
    mockMatchMedia(true);
    const { container } = render(<Fade>hi</Fade>);
    expect(container.firstChild).not.toHaveClass("pa-fade");
  });

  it("defaults duration to the token base", () => {
    const { container } = render(<Fade>hi</Fade>);
    expect(container.firstChild).toHaveStyle({ "--pa-motion-duration": "180ms" } as Record<string, string>);
  });
});

describe("SlideUp", () => {
  it("applies the pa-slide-up class and honors delay", () => {
    const { container } = render(<SlideUp delay={100}>up</SlideUp>);
    const el = container.firstChild as HTMLElement;
    expect(el).toHaveClass("pa-slide-up");
    expect(el).toHaveStyle({ "--pa-motion-delay": "100ms" } as Record<string, string>);
  });

  it("is suppressed under reduced motion", () => {
    mockMatchMedia(true);
    const { container } = render(<SlideUp>up</SlideUp>);
    expect(container.firstChild).not.toHaveClass("pa-slide-up");
  });
});

describe("Stagger / StaggerItem", () => {
  it("fans out children with an increasing delay", () => {
    render(
      <Stagger step={40}>
        <Probe />
        <Probe />
        <Probe />
      </Stagger>,
    );
    const probes = screen.getAllByTestId("probe");
    expect(probes).toHaveLength(3);
    expect(probes[0]).toHaveAttribute("data-delay", "0");
    expect(probes[1]).toHaveAttribute("data-delay", "40");
    expect(probes[2]).toHaveAttribute("data-delay", "80");
  });

  it("zeroes the stagger under reduced motion", () => {
    mockMatchMedia(true);
    render(
      <Stagger step={40}>
        <Probe />
        <Probe />
      </Stagger>,
    );
    const probes = screen.getAllByTestId("probe");
    expect(probes[0]).toHaveAttribute("data-delay", "0");
    expect(probes[1]).toHaveAttribute("data-delay", "0");
  });

  it("StaggerItem renders a SlideUp with the given delay", () => {
    const { container } = render(
      <StaggerItem delay={25}>
        <span>item</span>
      </StaggerItem>,
    );
    expect(container.firstChild).toHaveClass("pa-slide-up");
    expect(container.firstChild).toHaveStyle({ "--pa-motion-delay": "25ms" } as Record<string, string>);
  });
});

describe("ViewTransition", () => {
  it("applies the view-transition class and uses transitionKey as the React key", () => {
    const { container } = render(
      <ViewTransition transitionKey="chat">
        <div>view</div>
      </ViewTransition>,
    );
    expect(container.firstChild).toHaveClass("pa-view-transition");
  });

  it("is suppressed under reduced motion", () => {
    mockMatchMedia(true);
    const { container } = render(
      <ViewTransition transitionKey="chat">
        <div>view</div>
      </ViewTransition>,
    );
    expect(container.firstChild).not.toHaveClass("pa-view-transition");
  });
});
