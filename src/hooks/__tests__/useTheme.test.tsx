// useTheme.test.tsx — the theme hook reads Settings.theme via IPC, applies it
// through design/theme, subscribes to theme-setting changes so a change from
// anywhere re-applies, and keeps the "system" matchMedia subscription live.

import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTheme } from "../useTheme";

const themeMock = vi.hoisted(() => {
  const listeners: Array<(theme: string) => void> = [];
  return {
    applyTheme: vi.fn(),
    resolveTheme: vi.fn((t: string) => (t === "light" ? "light" : "dark")),
    subscribeTheme: vi.fn((cb: (theme: string) => void) => {
      listeners.push(cb);
      return () => {
        const i = listeners.indexOf(cb);
        if (i >= 0) listeners.splice(i, 1);
      };
    }),
    _listeners: listeners,
  };
});

vi.mock("../../design/theme", () => themeMock);

const ipcMock = vi.hoisted(() => ({
  getSettings: vi.fn(),
}));

vi.mock("../../ipc/client", () => ({
  useIpc: () => ipcMock,
}));

function mockMatchMedia() {
  const mql = {
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockReturnValue(mql),
  });
  return mql;
}

beforeEach(() => {
  themeMock.applyTheme.mockClear();
  themeMock.subscribeTheme.mockReset();
  // Re-establish the push-to-listeners implementation after mockReset.
  themeMock.subscribeTheme.mockImplementation((cb: (theme: string) => void) => {
    themeMock._listeners.push(cb);
    return () => {
      const i = themeMock._listeners.indexOf(cb);
      if (i >= 0) themeMock._listeners.splice(i, 1);
    };
  });
  themeMock._listeners.length = 0;
  ipcMock.getSettings.mockReset();
  (ipcMock.getSettings as ReturnType<typeof vi.fn>).mockResolvedValue({});
  mockMatchMedia();
});

describe("useTheme", () => {
  it("applies the persisted theme from settings (dark default)", async () => {
    (ipcMock.getSettings as ReturnType<typeof vi.fn>).mockResolvedValue({});
    renderHook(() => useTheme());
    await vi.waitFor(() => expect(themeMock.applyTheme).toHaveBeenCalledWith("dark"));
  });

  it("applies the light theme when settings say so", async () => {
    (ipcMock.getSettings as ReturnType<typeof vi.fn>).mockResolvedValue({ theme: "light" });
    renderHook(() => useTheme());
    await vi.waitFor(() => expect(themeMock.applyTheme).toHaveBeenCalledWith("light"));
  });

  it("falls back to dark when reading settings fails", async () => {
    (ipcMock.getSettings as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("daemon down"));
    renderHook(() => useTheme());
    await vi.waitFor(() => expect(themeMock.applyTheme).toHaveBeenCalledWith("dark"));
  });

  it("subscribes to theme changes and re-applies", async () => {
    renderHook(() => useTheme());
    await vi.waitFor(() => expect(themeMock.subscribeTheme).toHaveBeenCalledTimes(1));

    act(() => {
      for (const l of themeMock._listeners) l("light");
    });
    expect(themeMock.applyTheme).toHaveBeenCalledWith("light");
  });

  it("unsubscribes from the theme store on unmount", async () => {
    const unsub = vi.fn();
    themeMock.subscribeTheme.mockReturnValue(unsub);
    const { unmount } = renderHook(() => useTheme());
    await vi.waitFor(() => expect(themeMock.subscribeTheme).toHaveBeenCalledTimes(1));
    unmount();
    expect(unsub).toHaveBeenCalled();
  });

  it("keeps a live matchMedia subscription for the system theme", async () => {
    const mql = mockMatchMedia();
    renderHook(() => useTheme());
    await vi.waitFor(() => expect(themeMock.subscribeTheme).toHaveBeenCalledTimes(1));

    // Trigger a theme change to "system" through the store.
    act(() => {
      for (const l of themeMock._listeners) l("system");
    });
    expect(mql.addEventListener).toHaveBeenCalledWith("change", expect.any(Function));
  });
});
