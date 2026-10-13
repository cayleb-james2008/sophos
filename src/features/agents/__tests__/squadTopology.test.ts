import { describe, expect, it } from "vitest";
import { MockIpcClient } from "../../../ipc/mockClient";

describe("Gauntlet-RLM Squad Topology & Evaluator-Optimizer", () => {
  it("surfaces orchestrator, worker, researcher, and blind critic members", async () => {
    const client = new MockIpcClient();
    const topology = await client.getSquadTopology();

    expect(topology.orchestrator).toBeDefined();
    expect(topology.orchestrator.role).toBe("orchestrator");

    const roles = topology.members.map((m) => m.role);
    expect(roles).toContain("worker");
    expect(roles).toContain("critic_text");
    expect(roles).toContain("researcher");
  });

  it("updates evaluation round and attaches blind critic rubric on evaluation", async () => {
    const client = new MockIpcClient();
    const initialTopology = await client.getSquadTopology();
    const worker = initialTopology.members.find((m) => m.id === "worker-1");
    const initialRounds = worker?.reviewRounds ?? 0;

    const rubric = await client.evaluateSquadPiece(
      "worker-1",
      "Outcome: Modernize harness architecture",
      "Bar: 100% tests green, zero regressions",
      ["src/ipc/contract.ts", "src/features/code/toolRegistry.ts"],
    );

    expect(rubric.contractVerdict).toBe("PASS");
    expect(rubric.barVerdict).toBe("PASS");
    expect(rubric.reviewRound).toBe(initialRounds + 1);

    const updatedTopology = await client.getSquadTopology();
    const updatedWorker = updatedTopology.members.find((m) => m.id === "worker-1");
    expect(updatedWorker?.reviewRounds).toBe(initialRounds + 1);
    expect(updatedWorker?.latestRubric).toBeDefined();
    expect(updatedWorker?.latestRubric?.barVerdict).toBe("PASS");
  });
});
