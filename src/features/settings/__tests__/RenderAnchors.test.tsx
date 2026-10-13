// RenderAnchors.test.tsx — Pin the previously-failing cua e2e anchor strings to
// the Settings UI so they can never silently regress. The live cua-driver e2e is
// blocked on this machine (the cua-driver daemon is not running — see
// verify/cua/cua-run-all.err), so this render test is the deterministic,
// in-repo proof that the honest labels render.
//
// Anchors covered (all are static labels the Settings surface must show):
//   - "Configured extensions"  (Extensions tab  → ExtensionsPanel)
//   - "Subagent model policy"  (Subagents tab   → SubagentPolicyPanel)
//   - "Autonomous mode"        (Long-running tab → LongRunningPanel → AutonomousPanel)
//   - "GitLab"                 (About tab        → AboutPanel)
//
// Each owning component is mounted against a MockIpcClient-shaped client that
// returns the same demo data the real MockIpcClient surfaces, so the assertions
// exercise the real render path (loading → settled), not a hollow stub.

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExtensionsPanel } from "../ExtensionsPanel";
import { SubagentPolicyPanel } from "../SubagentPolicyPanel";
import { LongRunningPanel } from "../LongRunningPanel";
import { AboutPanel } from "../AboutPanel";

const mockClient = vi.hoisted(() => ({
  getSettings: vi.fn(),
  getRuntimeInfo: vi.fn(),
  getExtensions: vi.fn(),
  getProviders: vi.fn(),
  getModels: vi.fn(),
  setSettings: vi.fn(),
  prompt: vi.fn(),
  steer: vi.fn(),
}));

vi.mock("../../../ipc/client", async () => ({
  useIpc: () => mockClient,
  isDemoMode: () => true,
  useIpcEvent: () => undefined,
  useConnectionState: () => ({
    status: { kind: "connected" },
    autonomousConfig: {
      active: false,
      maxTurns: 12,
      maxTokens: 80000,
      maxTime: "30m",
      qualityGates: [],
    },
    context: { tokens: 18432, contextWindow: 1000000, messages: 42 },
    queue: { mode: "idle" },
  }),
  isTauri: false,
}));

const DEMO_EXTENSIONS = [
  { name: "github-integration", path: "~/.pi/agent/extensions/github-integration", enabled: true },
  { name: "linear-sync", path: "~/.pi/agent/extensions/linear-sync", enabled: true },
];

beforeEach(() => {
  vi.clearAllMocks();
  (mockClient.getSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
    extensions: DEMO_EXTENSIONS,
    localProviders: [],
  });
  (mockClient.getRuntimeInfo as ReturnType<typeof vi.fn>).mockResolvedValue({
    cwd: "C:\\work",
    kernel: { status: "configured", persistent: true, toolAvailable: true },
    skills: [],
    skillDiagnostics: [],
    extensions: DEMO_EXTENSIONS.map((e) => e.path),
  });
  (mockClient.getExtensions as ReturnType<typeof vi.fn>).mockResolvedValue(
    DEMO_EXTENSIONS.map((e) => ({
      name: e.name,
      path: e.path,
      enabled: true,
      tools: [{ name: "tool1", description: "Runs a thing" }],
      slashCommands: [{ name: "extcmd", description: "Runs a command" }],
    })),
  );
  (mockClient.getProviders as ReturnType<typeof vi.fn>).mockResolvedValue([
    { id: "ollama-cloud", name: "Ollama Cloud", kind: "api_key", connected: true, models: [] },
  ]);
  (mockClient.getModels as ReturnType<typeof vi.fn>).mockResolvedValue([
    {
      id: "deepseek-v4-flash:0731-cloud",
      name: "DeepSeek V4 Flash 0731",
      provider: "ollama-cloud",
      contextWindow: 1000000,
      maxOutputTokens: 65536,
    },
  ]);
  (mockClient.setSettings as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (mockClient.prompt as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (mockClient.steer as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
});

describe("Settings e2e anchor strings render", () => {
  it('Extensions tab renders "Configured extensions"', async () => {
    render(<ExtensionsPanel />);
    // Heading + the configured extension names must both be present once the
    // demo data settles (the heading is the e2e anchor; the names prove the
    // list actually populated, not just an empty header).
    expect(await screen.findByText("Configured extensions", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(await screen.findByText("github-integration", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText("linear-sync")).toBeInTheDocument();
  });

  it('Subagents tab renders "Subagent model policy"', async () => {
    render(<SubagentPolicyPanel />);
    // The panel heading renders unconditionally (outside the loading gate), so
    // the anchor is present immediately; the policy fields settle alongside it.
    expect(await screen.findByText("Subagent model policy", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText("Provider")).toBeInTheDocument();
    expect(screen.getByText("Thinking level")).toBeInTheDocument();
  });

  it('Long-running tab renders "Autonomous mode"', async () => {
    render(<LongRunningPanel />);
    // LongRunningPanel defaults to the Autonomous inner tab → AutonomousPanel,
    // whose heading is the e2e anchor.
    expect(await screen.findByText("Autonomous mode", {}, { timeout: 3000 })).toBeInTheDocument();
  });

  it('About tab renders "GitLab"', async () => {
    render(<AboutPanel />);
    expect(await screen.findByText("GitLab", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText("Changelog")).toBeInTheDocument();
  });
});
