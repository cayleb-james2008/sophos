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
});
