// AdvancedPanel.test.tsx — AdvancedPanel is a thin orchestrator: it loads all
// runtime telemetry on mount and wires the compact / attach / refresh actions
// through to the IPC client. Child panels are stubbed so this test isolates the
// orchestration layer.

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdvancedPanel } from "../AdvancedPanel";

const mockClient = vi.hoisted(() => ({
  getContextStats: vi.fn(),
  getRuntimeInfo: vi.fn(),
  getRlmChildren: vi.fn(),
  listAgents: vi.fn(),
  getSettings: vi.fn(),
  getState: vi.fn(),
  compact: vi.fn(),
  attachAgent: vi.fn(),
  testMcpServer: vi.fn(),
  setSettings: vi.fn(),
}));

vi.mock("../../../ipc/client", async () => ({
  useIpc: () => mockClient,
  useIpcEvent: () => undefined,
  useConnectionState: () => ({ status: { kind: "connected" } }),
}));

// Stub the heavy child panels so AdvancedPanel's orchestration is the only
// behavior under test.
vi.mock("../KernelPanel", async () => ({
  KernelPanel: () => <div>kernel-panel-stub</div>,
}));
vi.mock("../ContextPanel", async () => ({
  ContextPanel: ({ onCompact }: { onCompact: () => void }) => (
    <button onClick={onCompact}>compact-ctx</button>
  ),
}));
vi.mock("../RlmChildrenPanel", async () => ({
  RlmChildrenPanel: () => <div>rlm-panel-stub</div>,
}));
vi.mock("../McpServersPanel", async () => ({
  McpServersPanel: () => <div>mcp-panel-stub</div>,
}));
vi.mock("../DaemonPanel", async () => ({
  DaemonTransportCard: () => <div>transport-stub</div>,
  DaemonDiagnosticsCard: () => <div>diagnostics-stub</div>,
}));
vi.mock("../AgentsPanel", async () => ({
  AgentsPanel: () => <div>agents-stub</div>,
}));

const RUNTIME = {
  cwd: "C:\\work",
  kernel: { status: "configured", persistent: true, toolAvailable: true, sessionId: "s1" },
  skills: [],
  skillDiagnostics: [],
  extensions: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  (mockClient.getContextStats as ReturnType<typeof vi.fn>).mockResolvedValue({ tokens: 10, contextWindow: 100 });
  (mockClient.getRuntimeInfo as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.parse(JSON.stringify(RUNTIME)));
  (mockClient.getRlmChildren as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (mockClient.listAgents as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (mockClient.getSettings as ReturnType<typeof vi.fn>).mockResolvedValue({});
  (mockClient.getState as ReturnType<typeof vi.fn>).mockResolvedValue({ status: { kind: "connected" } });
  (mockClient.compact as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (mockClient.attachAgent as ReturnType<typeof vi.fn>).mockResolvedValue({ childId: "c", sessionId: "s", attached: true });
  (mockClient.testMcpServer as ReturnType<typeof vi.fn>).mockResolvedValue({ serverName: "x", connected: true });
  (mockClient.setSettings as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
});

describe("AdvancedPanel", () => {
  it("loads all runtime telemetry on mount", async () => {
    render(<AdvancedPanel />);

    await waitFor(() => expect(mockClient.getContextStats).toHaveBeenCalled());
    expect(mockClient.getRuntimeInfo).toHaveBeenCalled();
    expect(mockClient.getRlmChildren).toHaveBeenCalled();
    expect(mockClient.listAgents).toHaveBeenCalled();
    expect(mockClient.getSettings).toHaveBeenCalled();
    expect(mockClient.getState).toHaveBeenCalled();
  });

  it("renders the telemetry eyebrow and composed child panels", async () => {
    render(<AdvancedPanel />);

    expect(screen.getByText(/Runtime telemetry/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("kernel-panel-stub")).toBeInTheDocument());
    expect(screen.getByText("rlm-panel-stub")).toBeInTheDocument();
    expect(screen.getByText("mcp-panel-stub")).toBeInTheDocument();
    expect(screen.getByText("transport-stub")).toBeInTheDocument();
    expect(screen.getByText("diagnostics-stub")).toBeInTheDocument();
    expect(screen.getByText("agents-stub")).toBeInTheDocument();
  });

  it("wires the ContextPanel compact action to ipc.compact followed by a refresh", async () => {
    const user = userEvent.setup();
    render(<AdvancedPanel />);
    await waitFor(() => expect(screen.getByRole("button", { name: /compact-ctx/i })).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /compact-ctx/i }));

    await waitFor(() => expect(mockClient.compact).toHaveBeenCalledTimes(1));
    // compact().then(refresh) => a second getContextStats round-trip.
    await waitFor(() => expect(mockClient.getContextStats).toHaveBeenCalledTimes(2));
  });
});
