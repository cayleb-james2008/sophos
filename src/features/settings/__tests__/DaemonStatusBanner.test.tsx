// DaemonStatusBanner.test.tsx — DaemonStatusBanner renders only when the
// connection is down, explains the failure in plain English, and offers the
// TCP-loopback fallback that persists daemonTcp via setSettings.

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DaemonStatusBanner } from "../DaemonStatusBanner";

const mockClient = vi.hoisted(() => ({
  getSettings: vi.fn(),
  setSettings: vi.fn(),
}));

const mockConn = vi.hoisted(() => ({
  status: { kind: "connected" as const },
  model: undefined,
}));

vi.mock("../../../ipc/client", async () => ({
  useIpc: () => mockClient,
  useIpcEvent: () => undefined,
  useConnectionState: () => mockConn,
}));

function setStatus(status: { kind: string; reason?: string }) {
  mockConn.status = status as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  (mockClient.getSettings as ReturnType<typeof vi.fn>).mockResolvedValue({ daemonTcp: false });
  (mockClient.setSettings as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
});

describe("DaemonStatusBanner", () => {
  it("renders nothing when the connection is up", async () => {
    setStatus({ kind: "connected" });
    render(<DaemonStatusBanner />);
    await waitFor(() => expect(mockClient.getSettings).toHaveBeenCalled());
    expect(screen.queryByText(/Agent engine offline/i)).not.toBeInTheDocument();
  });

  it("renders the offline banner with the plain-English reason when disconnected", async () => {
    setStatus({ kind: "disconnected", reason: "named-pipe creation blocked" });
    render(<DaemonStatusBanner />);

    expect(await screen.findByText(/Agent engine offline/i)).toBeInTheDocument();
    expect(screen.getByText(/named-pipe creation blocked/i)).toBeInTheDocument();
  });

  it("persists the TCP fallback and flips to the already-enabled state", async () => {
    const user = userEvent.setup();
    setStatus({ kind: "disconnected" });
    render(<DaemonStatusBanner />);
    await screen.findByText(/Agent engine offline/i);

    await user.click(screen.getByRole("button", { name: /enable tcp mode/i }));

    await waitFor(() => expect(mockClient.setSettings).toHaveBeenCalledWith({ daemonTcp: true }));
    // Once daemonTcp is saved the card swaps to the already-enabled guidance.
    expect(await screen.findByText(/TCP mode is already enabled/i)).toBeInTheDocument();
  });

  it("shows that TCP mode is already enabled when the setting is true", async () => {
    setStatus({ kind: "reconnecting" });
    (mockClient.getSettings as ReturnType<typeof vi.fn>).mockResolvedValue({ daemonTcp: true });
    render(<DaemonStatusBanner />);

    expect(await screen.findByText(/TCP mode is already enabled/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /enable tcp mode/i })).not.toBeInTheDocument();
  });

  it("surfaces an error when the TCP toggle save fails", async () => {
    const user = userEvent.setup();
    setStatus({ kind: "disconnected" });
    (mockClient.setSettings as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("write denied"));
    render(<DaemonStatusBanner />);
    await screen.findByText(/Agent engine offline/i);

    await user.click(screen.getByRole("button", { name: /enable tcp mode/i }));

    expect(await screen.findByText(/write denied/i)).toBeInTheDocument();
  });
});
