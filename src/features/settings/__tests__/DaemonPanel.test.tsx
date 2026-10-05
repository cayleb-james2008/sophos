// DaemonPanel.test.tsx — DaemonTransportCard toggles the TCP-loopback fallback
// and persists it via setSettings; DaemonDiagnosticsCard renders connection /
// transport / socket status and wires Refresh to onRefresh.

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DaemonTransportCard, DaemonDiagnosticsCard } from "../DaemonPanel";

const mockClient = vi.hoisted(() => ({
  getSettings: vi.fn(),
  setSettings: vi.fn(),
}));

vi.mock("../../../ipc/client", async () => ({
  useIpc: () => mockClient,
  useIpcEvent: () => undefined,
  useConnectionState: () => ({ status: { kind: "connected" }, model: undefined }),
}));

describe("DaemonTransportCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (mockClient.getSettings as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (mockClient.setSettings as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  it("defaults the toggle off when no daemonTcp setting is saved", async () => {
    render(<DaemonTransportCard />);
    await waitFor(() => expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false"));
    expect(screen.queryByText(/TCP loopback fallback armed/i)).not.toBeInTheDocument();
  });

  it("keeps a stale daemonTcp=true setting disabled and labels TCP unsupported", async () => {
    (mockClient.getSettings as ReturnType<typeof vi.fn>).mockResolvedValue({ daemonTcp: true });
    render(<DaemonTransportCard />);
    const control = screen.getByRole("switch");
    expect(control).toBeDisabled();
    expect(control).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(/TCP fallback is unsupported by pinned Prime Agent/i)).toBeInTheDocument();
    expect(screen.getByText(/default local socket/i)).toBeInTheDocument();
  });

  it("does not read the obsolete persisted transport setting", () => {
    render(<DaemonTransportCard />);
    expect(mockClient.getSettings).not.toHaveBeenCalled();
    expect(mockClient.setSettings).not.toHaveBeenCalled();
  });

  it("does not persist or enable the unsupported transport", async () => {
    const user = userEvent.setup();
    render(<DaemonTransportCard />);
    const control = screen.getByRole("switch");
    expect(control).toBeDisabled();
    await user.click(control);
    expect(mockClient.setSettings).not.toHaveBeenCalled();
  });
});

describe("DaemonDiagnosticsCard", () => {
  it("renders a connected state with TCP enabled and the socket path", () => {
    render(
      <DaemonDiagnosticsCard
        status={{ connected: true, tcpEnabled: true, socketPath: "\\\\.\\pipe\\sophos" }}
        onRefresh={vi.fn()}
      />,
    );
    // "Connected" appears both as the top-right badge and the stat value.
    expect(screen.getAllByText("Connected").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/Pinned default local socket \(TCP unsupported\)/)).toBeInTheDocument();
    expect(screen.getByText("\\\\.\\pipe\\sophos")).toBeInTheDocument();
  });

  it("renders a disconnected state with TCP disabled and a fallback socket", () => {
    render(<DaemonDiagnosticsCard status={{ connected: false, tcpEnabled: false }} onRefresh={vi.fn()} />);
    expect(screen.getAllByText("Disconnected").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/Pinned default local socket \(TCP unsupported\)/)).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("calls onRefresh when Refresh is clicked", async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    render(<DaemonDiagnosticsCard status={{ connected: false }} onRefresh={onRefresh} />);

    await user.click(screen.getByRole("button", { name: /refresh/i }));

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
