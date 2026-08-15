// FleetStrip.test.tsx — FleetStrip reads live IPC data to show running agents,
// context-token usage, provider connectivity, and the current model.

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FleetStrip } from "../FleetStrip";

const mockClient = vi.hoisted(() => ({
  listAgents: vi.fn(),
  getContextStats: vi.fn(),
  getProviders: vi.fn(),
}));

const mockConn = vi.hoisted(() => ({
  status: { kind: "connected" },
  model: { provider: "ollama-cloud", model: "deepseek-v4-flash:0731-cloud" },
}));

vi.mock("../../../ipc/client", async () => ({
  useIpc: () => mockClient,
  useIpcEvent: () => undefined,
  useConnectionState: () => mockConn,
}));

const byTextContent = (text: string) => (_: string, el?: Element | null) =>
  !!el && el.textContent?.replace(/\s+/g, " ").trim() === text;

describe("FleetStrip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (mockClient.listAgents as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "1", status: "running" },
      { id: "2", status: "running" },
      { id: "3", status: "idle" },
    ]);
    (mockClient.getContextStats as ReturnType<typeof vi.fn>).mockResolvedValue({ tokens: 100000, contextWindow: 1000000 });
    (mockClient.getProviders as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "ollama-cloud", connected: true },
      { id: "openrouter", connected: false },
    ]);
  });

  it("renders running-agent, context, provider, and model readouts", async () => {
    render(<FleetStrip />);

    await waitFor(() => expect(screen.getByText(byTextContent("2 / 3"))).toBeInTheDocument());
    expect(screen.getByText(byTextContent("100.0k · 10%"))).toBeInTheDocument();
    expect(screen.getByText(byTextContent("1 / 2 connected"))).toBeInTheDocument();
    expect(screen.getByText("deepseek-v4-flash:0731-cloud")).toBeInTheDocument();
  });

  it("counts zero running agents and shows a fallback model when none is set", async () => {
    (mockClient.listAgents as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (mockClient.getContextStats as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (mockClient.getProviders as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    mockConn.model = undefined as never;

    render(<FleetStrip />);

    await waitFor(() => expect(screen.getByText(byTextContent("0 / 0"))).toBeInTheDocument());
    expect(screen.getByText(byTextContent("0 / 0 connected"))).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
