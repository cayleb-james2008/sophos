// useActionError — shared async-action error handling for the long-running /
// goals panels, plus the ActionErrorBanner renderer. No IPC required.

import { act, renderHook } from "@testing-library/react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ActionErrorBanner, useActionError } from "../useActionError";

describe("useActionError", () => {
  it("starts with no error", () => {
    const { result } = renderHook(() => useActionError());
    expect(result.current.error).toBeNull();
  });

  it("keeps error null when the action resolves", async () => {
    const { result } = renderHook(() => useActionError());
    const fn = vi.fn().mockResolvedValue(undefined);
    await act(async () => {
      await result.current.run(fn);
    });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeNull();
  });

  it("surfaces the Error message on rejection", async () => {
    const { result } = renderHook(() => useActionError());
    await act(async () => {
      await result.current.run(() => Promise.reject(new Error("no active daemon connection")));
    });
    expect(result.current.error).toBe("no active daemon connection");
  });

  it("falls back to the default when the message contains the word Error", async () => {
    const { result } = renderHook(() => useActionError());
    await act(async () => {
      await result.current.run(() => Promise.reject(new Error("SomeError happened")), "Action failed");
    });
    expect(result.current.error).toBe("Action failed");
  });

  it("stringifies a non-Error rejection", async () => {
    const { result } = renderHook(() => useActionError());
    await act(async () => {
      await result.current.run(() => Promise.reject("boom"), "Action failed");
    });
    expect(result.current.error).toBe("boom");
  });

  it("clearError clears a captured error", async () => {
    const { result } = renderHook(() => useActionError());
    await act(async () => {
      await result.current.run(() => Promise.reject(new Error("transient")));
    });
    expect(result.current.error).toBe("transient");
    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });

  it("clears a prior error before running again", async () => {
    const { result } = renderHook(() => useActionError());
    await act(async () => {
      await result.current.run(() => Promise.reject(new Error("first")));
    });
    expect(result.current.error).toBe("first");
    await act(async () => {
      await result.current.run(() => Promise.resolve());
    });
    expect(result.current.error).toBeNull();
  });
});

describe("ActionErrorBanner", () => {
  it("renders the message in a role=alert element", () => {
    render(<ActionErrorBanner message="daemon unreachable" />);
    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent("daemon unreachable");
  });
});
