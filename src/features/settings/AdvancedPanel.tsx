// AdvancedPanel — runtime telemetry: context/statistics (tokens, context
// window, compaction), RLM children (subagents), daemon diagnostics, MCP
// servers, and extensions. Thin orchestrator composing the extracted panels.

import { useCallback, useEffect, useState } from "react";
import { Text, Card, Badge, Spinner } from "../../design";
import { useIpc } from "../../ipc/client";
import type { AgentInfo, ContextStats, RlmChild, RuntimeInfo, Settings } from "../../ipc/contract";
import { ShieldIcon, CpuIcon } from "../sessions/icons";
import { KernelPanel } from "./KernelPanel";
import { ContextPanel } from "./ContextPanel";
import { RlmChildrenPanel } from "./RlmChildrenPanel";
import { McpServersPanel, type McpServer } from "./McpServersPanel";
import { DaemonTransportCard, DaemonDiagnosticsCard } from "./DaemonPanel";
import { AgentsPanel } from "./AgentsPanel";

export function AdvancedPanel() {
  const ipc = useIpc();
  const [context, setContext] = useState<ContextStats>({});
  const [runtime, setRuntime] = useState<RuntimeInfo>();
  const [children, setChildren] = useState<RlmChild[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [daemonStatus, setDaemonStatus] = useState<{ connected: boolean; tcpEnabled?: boolean; socketPath?: string }>({ connected: false });
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [settings, setSettings] = useState<Settings & { mcpServers?: McpServer[] }>({});
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [c, runtimeInfo, r, a, s] = await Promise.all([
        ipc.getContextStats(),
        ipc.getRuntimeInfo(),
        ipc.getRlmChildren(),
        ipc.listAgents(),
        ipc.getSettings(),
      ]);
      setContext(c ?? {});
      setRuntime(runtimeInfo);
      setChildren(r ?? []);
      setAgents(a ?? []);
      setSettings(s ?? {});

      // Daemon connection status from connection state
      const state = await ipc.getState();
      setDaemonStatus({
        connected: state.status.kind === "connected",
        // These would come from daemon config if exposed
        tcpEnabled: false,
        socketPath: undefined,
      });

      // MCP servers — read from settings if available
      // The daemon owns the real config; these are surfaced from settings.json
      const extendedSettings = s as Settings & { mcpServers?: McpServer[] };
      const mcp = extendedSettings.mcpServers;
      if (Array.isArray(mcp)) setMcpServers(mcp);
    } finally {
      setLoading(false);
    }
  }, [ipc]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="gp-form">
      <Text variant="micro" tone="dim" uppercase className="ap-eyebrow">
        Runtime telemetry
      </Text>

      {loading ? (
        <div className="ap-loading">
          <Spinner size={22} />
        </div>
      ) : (
        <>
          <TrustModelCard />
          <KernelCard runtime={runtime} />
          <KernelPanel />
          <DaemonTransportCard />
          <ContextPanel context={context} onCompact={() => void ipc.compact().then(() => refresh())} />
          <RlmChildrenPanel children={children} onRefresh={() => void refresh()} />
          <AgentsPanel agents={agents} onAttach={(id) => void ipc.attachAgent(id).then(() => refresh())} onRefresh={() => void refresh()} />
          <DaemonDiagnosticsCard status={daemonStatus} onRefresh={() => void refresh()} />
          <McpServersPanel servers={mcpServers} onChange={(next) => void ipc.setSettings({ ...settings, mcpServers: next } as Record<string, unknown>).then(() => refresh())} />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trust model — honest in-app disclosure (research D37-D39 / L4).
//
// Reviewers praised the README's candor that the kernel is "not a security
// sandbox" and runs model-generated code with user permissions. Surface that
// honestly in-app, calmly and informatively — not alarming.
// ---------------------------------------------------------------------------

function TrustModelCard() {
  return (
    <Card variant="raised" padding="lg" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="sp-headrow">
        <span className="sp-icon">
          <ShieldIcon size={16} />
        </span>
        <Text variant="label" weight="semibold">
          Trust model
        </Text>
        <Badge tone="warning">Not a sandbox</Badge>
      </div>
      <Text variant="body" tone="muted">
        Sophos executes model-generated code with your user permissions. It is not a security sandbox —
        code the agent runs can read, write, and execute on your machine with the same rights you have.
        Review what you ask it to run, and treat it like any tool with access to your system.
      </Text>
      <Text variant="micro" tone="dim">
        This matches the project's documented stance: the kernel is not a security boundary, and
        model-generated code runs with your permissions.
      </Text>
    </Card>
  );
}

function KernelCard({ runtime }: { runtime?: RuntimeInfo }) {
  const kernel = runtime?.kernel;
  const configured = kernel?.status === "configured";
  const browserPreview = kernel?.status === "browser-preview";
  return (
    <Card variant="raised" padding="lg" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="sp-head">
        <div className="sp-headrow">
          <CpuIcon size={16} />
          <Text variant="label" weight="semibold">Persistent IPython kernel</Text>
        </div>
        <Badge tone={configured ? "success" : browserPreview ? "neutral" : "warning"} dot>
          {configured ? "Configured" : browserPreview ? "Browser preview" : "Unavailable"}
        </Badge>
      </div>
      <Text variant="body" tone="muted">
        {configured
          ? "The live daemon exposes IPython as the persistent execution tool. Variables and imports survive across cells and compaction; a running-cell event is the proof of liveness."
          : browserPreview
            ? "The browser preview has no daemon or kernel. Open the Tauri app to inspect the live session capability."
            : "The live daemon did not expose the IPython tool for this session."}
      </Text>
      {kernel?.sessionId ? <Text variant="micro" tone="dim" mono>session {kernel.sessionId}</Text> : null}
      {runtime?.cwd ? <Text variant="micro" tone="dim" mono className="ap-cwd">cwd {runtime.cwd}</Text> : null}
    </Card>
  );
}
