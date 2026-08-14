// SystemBar — tests for the always-visible inline cost readout.
//
// The cost cell must render sessionCost in USD when costStats is present, and
// a muted "—" when costStats is absent. The dollar value must NOT use the green
// accent tone (green is signal-only). These tests mock the IPC layer and the
// refinement gate so SystemBar renders in isolation under jsdom.

import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionState } from "../../ipc/contract";

// Mock the refinement gate module so SystemBar's useRefinementGate() returns a
// stable idle state without needing the shared module-level store.
vi.mock("../../features/longrunning/useRefinementGate", () => ({
  useRefinementGate: () => ({ pending: null, history: [], autoApply: false, apply: vi.fn(), discard: vi.fn(), setAutoApply: vi.fn() }),
}));

type AnyFn = (...args: never[]) => unknown;

const mockState = vi.hoisted(() => ({
  connectionState: {
    status: { kind: "connected" },
    model: { provider: "ollama-cloud", model: "deepseek-v4-flash:0731-cloud", thinking: "high" },
    activeSessionId: "session-0",
    context: { tokens: 18432, contextWindow: 1000000, messages: 42 },
    costStats: { totalCost: 0.84, inputTokens: 421337, outputTokens: 118204, sessionCost: 0.31 },
  } as ConnectionState,
  client: {
    listAgents: vi.fn().mockResolvedValue([]),
    listSessions: vi.fn().mockResolvedValue([]),
    onEvent: vi.fn().mockReturnValue(() => {}),
  } as Record<string, AnyFn>,
}));

vi.mock("../../ipc/client", () => ({
  useConnectionState: () => mockState.connectionState,
  useIpc: () => mockState.client,
}));

import { SystemBar } from "../SystemBar";

beforeEach(() => {
  (mockState.client.listAgents as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (mockState.client.listSessions as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (mockState.client.onEvent as ReturnType<typeof vi.fn>).mockReturnValue(() => {});
});

function renderBar() {
  return render(<SystemBar engineOpen={false} onToggleEngine={() => {}} />);
}

describe("SystemBar cost readout", () => {
  it("renders the inline cost cell with sessionCost in USD when costStats is present", async () => {
    mockState.connectionState = {
      ...mockState.connectionState,
      costStats: { totalCost: 0.84, inputTokens: 421337, outputTokens: 118204, sessionCost: 0.31 },
    };
    renderBar();
    // The cost cell is labeled "Cost" and shows the session cost formatted as $0.31.
    const costCell = screen.getByLabelText("Session cost");
    expect(costCell).toBeInTheDocument();
    expect(costCell).toHaveTextContent("$0.31");
  });

  it("renders '—' (em dash) when costStats is absent", async () => {
    mockState.connectionState = {
      ...mockState.connectionState,
      costStats: undefined,
    };
    renderBar();
    const costCell = screen.getByLabelText("Session cost");
    expect(costCell).toBeInTheDocument();
    expect(costCell).toHaveTextContent("—");
  });

  it("does not use the green accent color for the cost value", async () => {
    mockState.connectionState = {
      ...mockState.connectionState,
      costStats: { totalCost: 0.84, inputTokens: 421337, outputTokens: 118204, sessionCost: 0.31 },
    };
    const { container } = renderBar();
    const costValue = container.querySelector(".system-bar__cost-value");
    expect(costValue).not.toBeNull();
    // The accent color is var(--pa-green) / var(--pa-green-hover). The cost value
    // uses muted text tone (rgba paper 0.62), not the accent. Check the computed
    // style does not resolve to the green accent — in jsdom, we check the class
    // is NOT an accent class. The system-bar__cost-value class has no accent token.
    expect(costValue!.className).toContain("system-bar__cost-value");
    // Ensure no accent/success/green class snuck in.
    expect(costValue!.className).not.toMatch(/accent|success|green/);
  });

  it("renders total tokens (input+output) alongside the cost when costStats is present", async () => {
    mockState.connectionState = {
      ...mockState.connectionState,
      costStats: { totalCost: 0.84, inputTokens: 421337, outputTokens: 118204, sessionCost: 0.31 },
    };
    const { container } = renderBar();
    const tokensEl = container.querySelector(".system-bar__cost-tokens");
    expect(tokensEl).not.toBeNull();
    // inputTokens + outputTokens = 421337 + 118204 = 539541 → formatted as 540k
    expect(tokensEl?.textContent).toContain("540k");
  });

  it("does not render the tokens span when costStats is absent", async () => {
    mockState.connectionState = {
      ...mockState.connectionState,
      costStats: undefined,
    };
    const { container } = renderBar();
    const tokensEl = container.querySelector(".system-bar__cost-tokens");
    expect(tokensEl).toBeNull();
  });
});
