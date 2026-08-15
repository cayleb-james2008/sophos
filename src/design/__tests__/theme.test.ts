// theme.test.ts — theme application + the tiny reactive store.
// resolveTheme decides the concrete palette (following the OS for "system");
// applyTheme writes data-theme on <html> and notifies subscribers only on an
// actual setting change.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveTheme, applyTheme, getTheme, subscribeTheme } from "../theme";

function mockMatchMedia(matches: boolean) {
  const mql = {
    matches,
    media: "(prefers-color-scheme: dark)",
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
  applyTheme("dark"); // reset the module-level currentTheme + DOM
  vi.restoreAllMocks();
});

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
});

describe("resolveTheme", () => {
  it("passes explicit themes through", () => {
    expect(resolveTheme("dark")).toBe("dark");
    expect(resolveTheme("light")).toBe("light");
  });

  it("resolves 'system' to dark when the OS prefers dark", () => {
    mockMatchMedia(true);
    expect(resolveTheme("system")).toBe("dark");
  });

  it("resolves 'system' to light when the OS prefers light", () => {
    mockMatchMedia(false);
    expect(resolveTheme("system")).toBe("light");
  });

  it("defaults 'system' to dark when matchMedia is unavailable", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: undefined,
    });
    expect(resolveTheme("system")).toBe("dark");
  });
});

describe("applyTheme / getTheme", () => {
  it("defaults to dark", () => {
    expect(getTheme()).toBe("dark");
  });

  it("sets data-theme on the document root", () => {
    applyTheme("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("records the resolved (not requested) setting for system", () => {
    mockMatchMedia(false);
    applyTheme("system");
    // currentTheme stores the *setting* "system"; the DOM gets the resolved light.
    expect(getTheme()).toBe("system");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("notifies subscribers only on an actual setting change", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeTheme(listener);

    applyTheme("dark"); // no-op — already current
    expect(listener).not.toHaveBeenCalled();

    applyTheme("light");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith("light");

    unsubscribe();
    applyTheme("dark");
    expect(listener).toHaveBeenCalledTimes(1); // no further calls after unsubscribe
  });

  it("notifies on a system re-apply only when the setting value differs", () => {
    const listener = vi.fn();
    subscribeTheme(listener);
    applyTheme("system");
    applyTheme("system"); // same setting — no notify
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
