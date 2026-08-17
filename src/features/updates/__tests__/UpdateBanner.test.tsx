// UpdateBanner tests — the auto-updater prompt (v0.7.2).
// Covers: renders nothing until an `update-available` event arrives, the
// banner shows the announced version, Install invokes `install_update` and
// flips to the downloading state, and `update-install-error` surfaces a
// visible failure.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UpdateBanner } from "../UpdateBanner";

const { eventListeners, mockEvent, invoke } = vi.hoisted(() => {
  const eventListeners: Record<string, (payload: unknown) => void> = {};
  return {
    eventListeners,
    mockEvent: {
      listen: vi.fn(
        async (event: string, handler: (e: { payload: unknown }) => void) => {
          eventListeners[event] = (payload: unknown) => handler({ payload });
          return vi.fn();
        },
      ),
    },
    invoke: vi.fn(async () => {}),
  };
});

vi.mock("@tauri-apps/api/event", () => mockEvent);
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

function emit(event: string, payload: unknown) {
  const fire = eventListeners[event];
  if (!fire) throw new Error(`no listener registered for ${event}`);
  fire(payload);
}

beforeEach(() => {
  Object.keys(eventListeners).forEach((k) => delete eventListeners[k]);
  mockEvent.listen.mockClear();
  invoke.mockClear();
});

describe("UpdateBanner", () => {
  it("renders nothing until an update-available event arrives", async () => {
    render(<UpdateBanner />);
    // Give the async listen() time to register.
    await vi.waitFor(() => expect(mockEvent.listen).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("listens for update-available and update-install-error", async () => {
    render(<UpdateBanner />);
    await vi.waitFor(() => expect(mockEvent.listen).toHaveBeenCalled());
    expect(mockEvent.listen).toHaveBeenCalledWith(
      "update-available",
      expect.any(Function),
    );
    expect(mockEvent.listen).toHaveBeenCalledWith(
      "update-install-error",
      expect.any(Function),
    );
  });

  it("shows the announced version and installs on click", async () => {
    const user = userEvent.setup();
    render(<UpdateBanner />);
    await vi.waitFor(() => expect(mockEvent.listen).toHaveBeenCalled());

    emit("update-available", { version: "0.7.3", notes: "Test notes" });

    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent("Update available — Sophos 0.7.3");
    expect(banner).toHaveTextContent("Test notes");

    await user.click(screen.getByRole("button", { name: /install/i }));
    expect(invoke).toHaveBeenCalledWith("install_update");
    expect(await screen.findByRole("status")).toHaveTextContent(
      /downloading update/i,
    );
  });

  it("surfaces a visible error when the install fails", async () => {
    render(<UpdateBanner />);
    await vi.waitFor(() => expect(mockEvent.listen).toHaveBeenCalled());

    emit("update-install-error", "signature mismatch");

    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent("Update failed");
    expect(banner).toHaveTextContent("signature mismatch");
  });

  it("unregisters its listeners on unmount", async () => {
    const unlisten = vi.fn();
    mockEvent.listen.mockResolvedValueOnce(unlisten);
    const { unmount } = render(<UpdateBanner />);
    await vi.waitFor(() => expect(mockEvent.listen).toHaveBeenCalled());
    unmount();
    await vi.waitFor(() => expect(unlisten).toHaveBeenCalled());
  });
});
