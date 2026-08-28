// SecuritySandboxPanel — Autonomous Workspace Security Sandbox & Blast Radius Governance.
// Implements 4-tier execution permission policies, real-time command blast radius preflight,
// guarded security zones (.git, .env, credentials), and live audit trails (SWE-agent concept).

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Input, Text } from "../../design";
import { getIpcClient } from "../../ipc/client";
import type { BlastRadiusReport, SecurityAuditEntry, WorkspaceSecurityPolicy } from "../../ipc/contract";
import "./security.css";

const POLICIES: Array<{
  id: WorkspaceSecurityPolicy;
  title: string;
  desc: string;
  badge: "danger" | "accent" | "success" | "neutral";
}> = [
  {
    id: "strict-sandbox",
    title: "Strict Sandbox",
    desc: "All shell commands and file mutations require explicit operator confirmation.",
    badge: "danger",
  },
  {
    id: "confirm-risky",
    title: "Confirm Risky (Default)",
    desc: "Auto-approves safe bounded reads; prompts on critical paths, bulk writes, or git internals.",
    badge: "accent",
  },
  {
    id: "permissive",
    title: "Permissive",
    desc: "Autonomous full-speed execution within the project root directory.",
    badge: "success",
  },
  {
    id: "network-isolated",
    title: "Network Isolated",
    desc: "Blocks all outbound HTTP/socket connections from tool invocations.",
    badge: "neutral",
  },
];

export function SecuritySandboxPanel() {
  const client = getIpcClient();
  const [activePolicy, setActivePolicy] = useState<WorkspaceSecurityPolicy>("confirm-risky");
  const [blockedPatterns, setBlockedPatterns] = useState<string[]>([]);
  const [auditLog, setAuditLog] = useState<SecurityAuditEntry[]>([]);
  const [probeCommand, setProbeCommand] = useState<string>("rm -rf .git/hooks");
  const [probeFiles, setProbeFiles] = useState<string>(".env.local, src/main.rs");
  const [blastReport, setBlastReport] = useState<BlastRadiusReport | null>(null);
  const [analyzing, setAnalyzing] = useState<boolean>(false);

  const loadSecurityState = useCallback(async () => {
    try {
      const sec = await client.getSecurityPolicy();
      setActivePolicy(sec.policy);
      setBlockedPatterns(sec.customBlockedPatterns);
      const logs = await client.getSecurityAuditLog();
      setAuditLog(logs);
    } catch {
      // Fallback in demo/preview
    }
  }, [client]);

  useEffect(() => {
    void loadSecurityState();
  }, [loadSecurityState]);

  const handleSelectPolicy = async (policy: WorkspaceSecurityPolicy) => {
    setActivePolicy(policy);
    await client.setSecurityPolicy(policy, blockedPatterns);
    await loadSecurityState();
  };

  const handleAnalyzeBlastRadius = async () => {
    setAnalyzing(true);
    try {
      const files = probeFiles
        .split(",")
        .map((f) => f.trim())
        .filter(Boolean);
      const report = await client.analyzeBlastRadius(probeCommand, files);
      setBlastReport(report);
      const logs = await client.getSecurityAuditLog();
      setAuditLog(logs);
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="security-panel" data-testid="security-sandbox-panel">
      <div className="sp-head">
        <div className="sp-headrow">
          <Text variant="label" weight="semibold">
            Autonomous Workspace Security Sandbox (SWE-agent Governance)
          </Text>
          <Badge tone="accent">Fail-Closed</Badge>
        </div>
        <Text variant="micro" tone="dim">
          Enforce bounded blast radius rules, path protections, and execution security policies across all
          agent tools.
        </Text>
      </div>

      {/* 4-Tier Security Policies */}
      <Card variant="raised" padding="md">
        <Text variant="label" weight="medium">
          Active Execution Policy
        </Text>
        <div className="security-policies-grid">
          {POLICIES.map((p) => (
            <div
              key={p.id}
              className={`security-policy-card ${activePolicy === p.id ? "security-policy-card--active" : ""}`}
              onClick={() => void handleSelectPolicy(p.id)}
            >
              <div className="sp-headrow">
                <Text variant="label" weight="bold">
                  {p.title}
                </Text>
                {activePolicy === p.id && <Badge tone={p.badge}>Active</Badge>}
              </div>
              <Text variant="micro" tone="dim">
                {p.desc}
              </Text>
            </div>
          ))}
        </div>
      </Card>

      {/* Guarded Security Zones */}
      <Card variant="default" padding="md">
        <Text variant="label" weight="medium">
          Guarded Security Zones (Forbidden Paths)
        </Text>
        <Text variant="micro" tone="dim">
          Any tool modification touching these glob patterns triggers an automatic security block or critical
          confirmation gate.
        </Text>
        <div className="mcp-capabilities-row" style={{ marginTop: "8px" }}>
          {blockedPatterns.map((pat) => (
            <Badge key={pat} tone="danger">
              {pat}
            </Badge>
          ))}
        </div>
      </Card>

      {/* Blast Radius Preflight Analyzer */}
      <div className="security-blast-analyzer">
        <div className="sp-headrow">
          <Text variant="label" weight="semibold">
            Live Blast Radius Preflight Analyzer
          </Text>
          <Button size="sm" onClick={() => void handleAnalyzeBlastRadius()} disabled={analyzing}>
            {analyzing ? "Analyzing…" : "Run Security Preflight"}
          </Button>
        </div>
        <Text variant="micro" tone="dim">
          Simulate command execution or file modifications against active policy and guarded zones.
        </Text>

        <div className="mcp-prompt-args">
          <Input
            label="Command String"
            value={probeCommand}
            onChange={(e) => setProbeCommand(e.target.value)}
            placeholder="e.g. npm run test or git checkout"
          />
          <Input
            label="Target Files (comma-separated)"
            value={probeFiles}
            onChange={(e) => setProbeFiles(e.target.value)}
            placeholder="e.g. .env, package.json, src/app.ts"
          />
        </div>

        {blastReport && (
          <div className="security-blast-result" data-testid="blast-radius-result">
            <div className="sp-headrow">
              <Text variant="label" weight="bold">
                Preflight Risk Assessment:
              </Text>
              <Badge
                tone={
                  blastReport.riskLevel === "low"
                    ? "success"
                    : blastReport.riskLevel === "medium"
                      ? "neutral"
                      : blastReport.riskLevel === "high"
                        ? "accent"
                        : "danger"
                }
              >
                {blastReport.riskLevel.toUpperCase()} RISK
              </Badge>
              <Badge tone={blastReport.requiresConfirmation ? "danger" : "success"}>
                {blastReport.requiresConfirmation ? "Confirmation Required" : "Auto-Approved"}
              </Badge>
            </div>

            <Text variant="micro" tone="dim">
              <strong>Files Targeted:</strong> {blastReport.filesTargeted} ·{" "}
              <strong>Forbidden Zones Hit:</strong> {blastReport.forbiddenPathsHit.join(", ") || "None"}
            </Text>

            <ul style={{ margin: "4px 0 0 16px", fontSize: "12px", color: "var(--color-text-dim)" }}>
              {blastReport.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>

            <Text variant="micro" weight="medium" tone="accent">
              Action Recommendation: {blastReport.suggestedAction}
            </Text>
          </div>
        )}
      </div>

      {/* Security Audit Trail */}
      <Card variant="raised" padding="md">
        <Text variant="label" weight="medium">
          Security Execution Audit Trail ({auditLog.length})
        </Text>
        <table className="security-audit-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Actor</th>
              <th>Command / Action</th>
              <th>Risk Level</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {auditLog.map((log) => (
              <tr key={log.id}>
                <td style={{ fontFamily: "var(--font-mono)", color: "var(--color-text-dim)" }}>
                  {new Date(log.timestamp).toLocaleTimeString()}
                </td>
                <td>{log.actor}</td>
                <td style={{ fontFamily: "var(--font-mono)" }}>{log.command}</td>
                <td>
                  <Badge
                    tone={
                      log.blastRadius.riskLevel === "low"
                        ? "success"
                        : log.blastRadius.riskLevel === "medium"
                          ? "neutral"
                          : log.blastRadius.riskLevel === "high"
                            ? "accent"
                            : "danger"
                    }
                  >
                    {log.blastRadius.riskLevel}
                  </Badge>
                </td>
                <td>
                  <Badge
                    tone={
                      log.status === "auto-passed"
                        ? "success"
                        : log.status === "approved"
                          ? "accent"
                          : "danger"
                    }
                  >
                    {log.status}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
