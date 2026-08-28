import { describe, expect, it } from "vitest";
import { MockIpcClient } from "../mockClient";

describe("Multi-Tier Semantic Memory & Durable Checkpoints (IPC Layer)", () => {
  it("retrieves partitioned memory tiers across Working, Recall, Archival", async () => {
    const client = new MockIpcClient();
    const state = await client.getMemoryState();

    expect(state.working.length).toBeGreaterThan(0);
    expect(state.recall.length).toBeGreaterThan(0);
    expect(state.archival.length).toBeGreaterThan(0);
    expect(state.totalCount).toBe(state.working.length + state.recall.length + state.archival.length);
    expect(state.uriIndex).toContain("viking://user/default/memories/entities/software_system/sophos.md");
  });

  it("filters memory by tier on demand", async () => {
    const client = new MockIpcClient();
    const archivalOnly = await client.getMemoryState("archival");

    expect(archivalOnly.archival.length).toBeGreaterThan(0);
    expect(archivalOnly.working.length).toBe(0);
    expect(archivalOnly.recall.length).toBe(0);
  });

  it("performs semantic keyword search across memories", async () => {
    const client = new MockIpcClient();
    const results = await client.searchMemory("Sophos");

    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.title.includes("Sophos") || r.content.includes("Sophos"))).toBe(true);
  });

  it("stores a new memory entry with bi-temporal validity tags", async () => {
    const client = new MockIpcClient();
    const created = await client.storeMemory({
      tier: "working",
      title: "Active Task Verification",
      content: "All test files passing with zero regressions",
      confidence: 1.0,
      tags: ["verification", "tests"],
      temporalValidity: { validFrom: "2026-08-28", assertedAt: new Date().toISOString() },
    });

    expect(created.id).toBeDefined();
    expect(created.title).toBe("Active Task Verification");

    const recalled = await client.recallMemory("Verification");
    expect(recalled.some((m) => m.includes("Active Task Verification"))).toBe(true);
  });

  it("forgets/invalidates a memory entry by ID", async () => {
    const client = new MockIpcClient();
    const entry = await client.storeMemory({
      tier: "recall",
      title: "Temporary Stale Fact",
      content: "This will be deleted",
      confidence: 0.5,
    });

    await client.forgetMemory(entry.id);
    const state = await client.getMemoryState();
    expect(state.recall.some((m) => m.id === entry.id)).toBe(false);
  });

  it("creates, lists, and restores durable session checkpoints", async () => {
    const client = new MockIpcClient();
    const initialList = await client.listCheckpoints();
    expect(initialList.length).toBeGreaterThan(0);

    const created = await client.createCheckpoint(
      "Pre-Refactor Checkpoint",
      "Saved before tool registry refactor",
    );
    expect(created.id).toBeDefined();
    expect(created.label).toBe("Pre-Refactor Checkpoint");
    expect(created.verifiedStatus).toBe("GREEN");

    const afterList = await client.listCheckpoints();
    expect(afterList.length).toBe(initialList.length + 1);

    const restored = await client.restoreCheckpoint(created.id);
    expect(restored.id).toBe(created.id);
    expect(restored.label).toBe("Pre-Refactor Checkpoint");
  });

  it("retrieves squad topology and evaluates blind critic rubrics", async () => {
    const client = new MockIpcClient();
    const topology = await client.getSquadTopology();

    expect(topology.orchestrator.role).toBe("orchestrator");
    expect(topology.members.length).toBeGreaterThan(0);
    expect(topology.members.some((m) => m.role === "critic_text")).toBe(true);

    const rubric = await client.evaluateSquadPiece(
      "worker-1",
      "Outcome: Add Code Intelligence tools",
      "Bar: Deterministic SDK generation",
      ["src/features/code/toolRegistry.ts"],
    );

    expect(rubric.contractVerdict).toBe("PASS");
    expect(rubric.barVerdict).toBe("PASS");
    expect(rubric.goalScore).toBeGreaterThan(0.9);
    expect(rubric.barScore).toBeGreaterThan(0.9);
  });
});
