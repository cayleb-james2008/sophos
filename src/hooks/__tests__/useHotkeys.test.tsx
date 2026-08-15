// useHotkeys.test.tsx — the global keyboard-shortcut registry. Modifier
// matching treats cmd and ctrl as cross-platform synonyms (meta-or-ctrl);
// typing inside form fields and event repeats are never hijacked. The listener
// is installed once and cleaned up on unmount.

import { renderHook, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { useHotkeys, type Hotkey } from "../useHotkeys";

function press(key: string, init: KeyboardEventInit = {}) {
  fireEvent.keyDown(window, { key, ...init });
}

describe("useHotkeys", () => {
  it("returns the same shortcuts array so callers can render help", () => {
    const shortcuts: Hotkey[] = [{ key: "n", handler: vi.fn(), description: "New" }];
    const { result } = renderHook(() => useHotkeys(shortcuts));
    expect(result.current).toBe(shortcuts);
  });

  it("fires the handler when the matching key is pressed", () => {
    const handler = vi.fn();
    renderHook(() => useHotkeys([{ key: "n", handler, description: "New" }]));
    press("n");
    expect(handler).toHaveBeenCalledTimes(1);
    press("m");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("is case-insensitive for letters", () => {
    const handler = vi.fn();
    renderHook(() => useHotkeys([{ key: "n", handler, description: "New" }]));
    press("N");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("requires the primary modifier (cmd/ctrl equivalence)", () => {
    const handler = vi.fn();
    renderHook(() =>
      useHotkeys([{ key: "/", modifiers: ["cmd"], handler, description: "Search" }]),
    );
    press("/"); // no modifier — not a match
    expect(handler).not.toHaveBeenCalled();
    press("/", { ctrlKey: true }); // ctrl == cmd
    expect(handler).toHaveBeenCalledTimes(1);
    press("/", { metaKey: true }); // meta == cmd
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("distinguishes shift and alt modifiers", () => {
    const handler = vi.fn();
    renderHook(() =>
      useHotkeys([{ key: "?", modifiers: ["shift"], handler, description: "Help" }]),
    );
    press("?");
    expect(handler).not.toHaveBeenCalled();
    press("?", { shiftKey: true });
    expect(handler).toHaveBeenCalledTimes(1);

    const altHandler = vi.fn();
    renderHook(() =>
      useHotkeys([{ key: "1", modifiers: ["alt"], handler: altHandler, description: "Tab" }]),
    );
    press("1", { altKey: true });
    expect(altHandler).toHaveBeenCalledTimes(1);
  });

  it("does not match when an extra modifier is held", () => {
    const handler = vi.fn();
    renderHook(() =>
      useHotkeys([{ key: "k", modifiers: ["cmd"], handler, description: "Palette" }]),
    );
    press("k", { ctrlKey: true, shiftKey: true }); // shift is extra
    expect(handler).not.toHaveBeenCalled();
  });

  it("ignores keypresses inside input, textarea, select, and contentEditable", () => {
    const handler = vi.fn();
    renderHook(() => useHotkeys([{ key: "/", handler, description: "Search" }]));

    for (const tag of ["INPUT", "TEXTAREA", "SELECT"]) {
      const el = document.createElement(tag);
      document.body.appendChild(el);
      fireEvent.keyDown(el, { key: "/" });
      el.remove();
    }

    const editable = document.createElement("div");
    editable.contentEditable = "true";
    // jsdom does not implement the isContentEditable getter; stub it so the
    // hook's contentEditable guard is exercised.
    Object.defineProperty(editable, "isContentEditable", { configurable: true, value: true });
    document.body.appendChild(editable);
    fireEvent.keyDown(editable, { key: "/" });
    editable.remove();

    expect(handler).not.toHaveBeenCalled();
  });

  it("ignores auto-repeated keydown events", () => {
    const handler = vi.fn();
    renderHook(() => useHotkeys([{ key: "n", handler, description: "New" }]));
    press("n", { repeat: true });
    expect(handler).not.toHaveBeenCalled();
  });

  it("fires only the first matching shortcut", () => {
    const first = vi.fn();
    const second = vi.fn();
    renderHook(() =>
      useHotkeys([
        { key: "a", handler: first, description: "First" },
        { key: "a", handler: second, description: "Second" },
      ]),
    );
    press("a");
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it("reads the latest shortcuts via a ref and cleans up on unmount", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender, unmount } = renderHook(
      ({ shortcuts }: { shortcuts: Hotkey[] }) => useHotkeys(shortcuts),
      { initialProps: { shortcuts: [{ key: "n", handler: first, description: "First" }] } },
    );

    // Swap handlers without re-registering the window listener.
    rerender({ shortcuts: [{ key: "n", handler: second, description: "Second" }] });
    press("n");
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();

    unmount();
    const afterUnmount = vi.fn();
    renderHook(() => useHotkeys([{ key: "n", handler: afterUnmount, description: "After" }]));
    // A new hook instance listens now; the old one's listener must be gone.
    press("n");
    expect(afterUnmount).toHaveBeenCalledTimes(1);
    // second should not have been called again after unmount via stale listener.
    expect(second).toHaveBeenCalledTimes(1);
  });
});
