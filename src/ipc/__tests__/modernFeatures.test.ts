import { describe, it, expect } from "vitest";
import { MockIpcClient } from "../mockClient";

describe("Modern Harness Features (MCP, Security Sandbox, Squad Workflows, Token Budget)", () => {
  const client = new MockIpcClient();

  it("discovers MCP servers and reads resource streams", async () => {
    const servers = await client.getMcpServers();
    expect(servers.length).toBeGreaterThanOrEqual(2);
    expect(servers.some((s) => s.name === "filesystem")).toBe(true);

    const res = await client.readMcpResource("filesystem", "file:///workspace/README.md");
    expect(res.name).toBe("Project README");
    expect(res.mimeType).toBe("text/markdown");
    expect(res.text).toContain("Sophos");
  });

  it("synthesizes MCP prompt templates with arguments", async () => {
    const prompt = await client.getMcpPrompt("filesystem", "code_review", {
      filePath: "src/main.rs",
      focus: "security",
    });
    expect(prompt.messages.length).toBe(1);
    expect(prompt.messages[0].content).toContain("src/main.rs");
  });

  it("enforces workspace security policies and computes blast radius", async () => {
    const initial = await client.getSecurityPolicy();
    expect(initial.policy).toBe("confirm-risky");

    // Critical blast zone test
    const reportCritical = await client.analyzeBlastRadius("git checkout .git/config", [".git/config"]);
    expect(reportCritical.riskLevel).toBe("critical");
    expect(reportCritical.requiresConfirmation).toBe(true);
    expect(reportCritical.forbiddenPathsHit).toContain(".git/**");

    // Low blast zone test
    const reportLow = await client.analyzeBlastRadius("git status", []);
    expect(reportLow.riskLevel).toBe("low");
    expect(reportLow.requiresConfirmation).toBe(false);

    // Audit log records
    const auditLogs = await client.getSecurityAuditLog();
    expect(auditLogs.length).toBeGreaterThan(0);
  });

  it("orchestrates squad workflows and computes consensus", async () => {
    const wf = await client.getSquadWorkflow();
    expect(wf.nodes.length).toBe(4);
    expect(wf.consensusScore).toBeGreaterThan(0.9);

    const ran = await client.runSquadWorkflow("consensus", "Verify Security Interlocks", "Zero Regressions");
    expect(ran.type).toBe("consensus");
  });

  it("calculates token budget and executes semantic compaction", async () => {
    const budget = await client.getTokenBudget();
    expect(budget.totalTokens).toBe(31200);
    expect(budget.tiers.chatHistory).toBe(16000);

    const compaction = await client.compactContext("semantic-summarize");
    expect(compaction.savedTokens).toBe(8500);
    expect(compaction.afterTokens).toBe(22700);

    const updated = await client.getTokenBudget();
    expect(updated.totalTokens).toBe(22700);
  });

  it("lists desktop windows, inspects UIA trees, and executes background actions", async () => {
    const windows = await client.listDesktopWindows();
    expect(windows.length).toBeGreaterThanOrEqual(2);
    expect(windows.some((w) => w.id === "win-sophos")).toBe(true);

    const tree = await client.inspectDesktopWindow("win-sophos");
    expect(tree.role).toBe("window");
    expect(tree.children?.length).toBeGreaterThan(0);

    const actionResult = await client.dispatchDesktopAction("win-sophos", {
      kind: "click",
      x: 300,
      y: 200,
    });
    expect(actionResult.success).toBe(true);
    expect(actionResult.durationMs).toBeGreaterThan(0);

    const snap = await client.captureDesktopScreenshot("win-sophos");
    expect(snap).toContain("data:image/svg+xml");
  });

  it("distills skills from trajectories and promotes to canonical library", async () => {
    const skills = await client.listDistilledSkills();
    expect(skills.length).toBeGreaterThanOrEqual(2);
    expect(skills.some((s) => s.name === "vitest-async-act-remediator")).toBe(true);

    const distilled = await client.distillSkillFromTrajectory("session-test-run", "new-auto-skill");
    expect(distilled.name).toBe("new-auto-skill");
    expect(distilled.isPromoted).toBe(false);

    const promotion = await client.promoteSkill(distilled.id);
    expect(promotion.success).toBe(true);
    expect(promotion.targetPath).toContain(".skill-library");

    await client.deleteDistilledSkill(distilled.id);
    const updated = await client.listDistilledSkills();
    expect(updated.some((s) => s.id === distilled.id)).toBe(false);
  });

  it("navigates speculative thought trees, explores branches, and promotes winner", async () => {
    const tree = await client.getThoughtTree();
    expect(tree.nodes.length).toBeGreaterThanOrEqual(3);
    expect(tree.rootId).toBe("node-root");

    const branched = await client.runSpeculativeBranch("node-root", "Hypothesis: In-memory cache layer");
    expect(branched.nodes.some((n) => n.label.includes("In-memory cache"))).toBe(true);

    const pruned = await client.pruneThoughtBranch("node-b2");
    const prunedNode = pruned.nodes.find((n) => n.id === "node-b2");
    expect(prunedNode?.status).toBe("pruned");

    const promoted = await client.promoteThoughtBranch("node-b1-diff");
    expect(promoted.bestNodeId).toBe("node-b1-diff");
  });

  it("spawns zero-copy workspace twins, executes commands, diffs, and rolls back cleanly", async () => {
    const twins = await client.listWorkspaceTwins();
    expect(twins.length).toBeGreaterThanOrEqual(2);
    expect(twins.some((t) => t.name === "twin-refactor-security")).toBe(true);

    const created = await client.createWorkspaceTwin("auto-audit-twin");
    expect(created.name).toBe("auto-audit-twin");
    expect(created.status).toBe("clean");

    const exec = await client.executeInTwin(created.id, "cargo test");
    expect(exec.exitCode).toBe(0);
    expect(exec.stdout).toContain("TWIN WORKTREE ISOLATION");

    const diff = await client.diffWorkspaceTwin(created.id);
    expect(diff.filesChanged.length).toBeGreaterThan(0);
    expect(diff.diffText).toContain("diff --git");

    const merged = await client.mergeWorkspaceTwin(created.id);
    expect(merged.success).toBe(true);

    const rollback = await client.rollbackWorkspaceTwin("twin-vitest-migration");
    expect(rollback.success).toBe(true);
  });
});
