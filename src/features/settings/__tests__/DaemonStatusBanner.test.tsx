// DaemonStatusBanner.test.tsx — DaemonStatusBanner renders only when the
// connection is down, explains the failure in plain English, and does not
// advertise the unsupported TCP fallback.

import { render, screen } from "@testing-library/react";
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
  it("renders nothing when the connection is up and does not read fallback settings", () => {
    setStatus({ kind: "connected" });
    render(<DaemonStatusBanner />);
    expect(screen.queryByText(/Agent engine offline/i)).not.toBeInTheDocument();
    expect(mockClient.getSettings).not.toHaveBeenCalled();
  });

  it("renders the offline banner with the plain-English reason when disconnected", async () => {
    setStatus({ kind: "disconnected", reason: "named-pipe creation blocked" });
    render(<DaemonStatusBanner />);

    expect(await screen.findByText(/Agent engine offline/i)).toBeInTheDocument();
    expect(screen.getByText(/named-pipe creation blocked/i)).toBeInTheDocument();
  });

  it("uses the supported local socket for reconnect diagnostics without TCP actions", async () => {
    setStatus({ kind: "reconnecting" });
    render(<DaemonStatusBanner />);

    expect(await screen.findByText(/Reconnecting to the agent engine on its default local socket/i)).toBeInTheDocument();
    expect(screen.getByText(/TCP fallback is unsupported by pinned Prime Agent/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /enable tcp mode/i })).not.toBeInTheDocument();
    expect(mockClient.setSettings).not.toHaveBeenCalled();
  });

  it("does not recommend TCP fallback when the engine is disconnected", async () => {
    setStatus({ kind: "disconnected" });
    render(<DaemonStatusBanner />);

    expect(await screen.findByText(/Agent engine offline/i)).toBeInTheDocument();
    expect(screen.getByText(/TCP fallback is unsupported by pinned Prime Agent/i)).toBeInTheDocument();
    expect(screen.getByText(/unsupported by pinned Prime Agent.*default local socket/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /enable tcp mode/i })).not.toBeInTheDocument();
    expect(mockClient.setSettings).not.toHaveBeenCalled();
  });

  it("does not treat a stale persisted daemonTcp=true value as an enabled transport", async () => {
    setStatus({ kind: "reconnecting" });
    (mockClient.getSettings as ReturnType<typeof vi.fn>).mockResolvedValue({ daemonTcp: true });
    render(<DaemonStatusBanner />);

    expect(await screen.findByText(/TCP fallback is unsupported by pinned Prime Agent/i)).toBeInTheDocument();
    expect(screen.getByText(/unsupported by pinned Prime Agent.*default local socket/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /enable tcp mode/i })).not.toBeInTheDocument();
    expect(mockClient.setSettings).not.toHaveBeenCalled();
  });
});
