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

  it("reflects a saved daemonTcp=true setting as an armed toggle + badge", async () => {
    (mockClient.getSettings as ReturnType<typeof vi.fn>).mockResolvedValue({ daemonTcp: true });
    render(<DaemonTransportCard />);
    await waitFor(() => expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true"));
    expect(screen.getByText(/TCP loopback fallback armed/i)).toBeInTheDocument();
  });

  it("persists an enable via setSettings and shows a saved confirmation", async () => {
    const user = userEvent.setup();
    render(<DaemonTransportCard />);
    await waitFor(() => expect(screen.getByRole("switch")).toBeInTheDocument());

    await user.click(screen.getByRole("switch"));

    await waitFor(() => expect(mockClient.setSettings).toHaveBeenCalledWith({ daemonTcp: true }));
    expect(screen.getByText(/Saved\. Restart the app/i)).toBeInTheDocument();
  });

  it("persists a disable back to setSettings", async () => {
    const user = userEvent.setup();
    (mockClient.getSettings as ReturnType<typeof vi.fn>).mockResolvedValue({ daemonTcp: true });
    render(<DaemonTransportCard />);
    await waitFor(() => expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true"));

    await user.click(screen.getByRole("switch"));

    await waitFor(() => expect(mockClient.setSettings).toHaveBeenCalledWith({ daemonTcp: false }));
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
    expect(screen.getByText("Enabled")).toBeInTheDocument();
    expect(screen.getByText("\\\\.\\pipe\\sophos")).toBeInTheDocument();
  });

  it("renders a disconnected state with TCP disabled and a fallback socket", () => {
    render(<DaemonDiagnosticsCard status={{ connected: false, tcpEnabled: false }} onRefresh={vi.fn()} />);
    expect(screen.getAllByText("Disconnected").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/Disabled \(Unix domain socket\)/)).toBeInTheDocument();
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
