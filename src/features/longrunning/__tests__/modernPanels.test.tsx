import { describe, expect, it, vi } from "vitest";
import { CANONICAL_PREFLIGHT_PROBES, AutonomousPanel } from "../AutonomousPanel";
import { HarnessStatePanel } from "../HarnessStatePanel";
import { render, screen } from "@testing-library/react";
import { MockIpcClient } from "../../../ipc/mockClient";

const mockClient = new MockIpcClient();

vi.mock("../../../ipc/client", async () => ({
  useIpc: () => mockClient,
  isDemoMode: () => true,
  useConnectionState: () => ({
    status: { kind: "connected" },
    autonomousConfig: { active: false },
    activeSessionId: "session-0",
  }),
}));

describe("Modern Panels (Memory Tiers & Autonomous Probes)", () => {
  it("defines the 4 non-negotiable canonical pre-flight probes", () => {
    expect(CANONICAL_PREFLIGHT_PROBES).toHaveLength(4);
    const probeIds = CANONICAL_PREFLIGHT_PROBES.map((p) => p.id);
    expect(probeIds).toContain("P-RUNTIME-SAFE");
    expect(probeIds).toContain("P-VENV-HEALTH");
    expect(probeIds).toContain("P-TOOLKIT-GREEN");
    expect(probeIds).toContain("P-TEST-RATCHET");
  });

  it("renders pre-flight probes in AutonomousPanel", () => {
    render(<AutonomousPanel defaultActive={false} />);

    expect(screen.getByText("P-RUNTIME-SAFE")).toBeDefined();
    expect(screen.getByText("P-VENV-HEALTH")).toBeDefined();
    expect(screen.getByText("P-TOOLKIT-GREEN")).toBeDefined();
    expect(screen.getByText("P-TEST-RATCHET")).toBeDefined();
  });

  it("renders continual harness and semantic memory switcher in HarnessStatePanel", async () => {
    render(<HarnessStatePanel />);

    expect(screen.getByText(/Continual harness & memory architecture/i)).toBeDefined();
    expect(screen.getByText(/Semantic memory tiers/i)).toBeDefined();
  });
});
