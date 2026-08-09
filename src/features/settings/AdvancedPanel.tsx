// AdvancedPanel — runtime telemetry: context/statistics (tokens, context
// window, compaction), RLM children (subagents), daemon diagnostics, MCP
// servers, and extensions. Wired to getContextStats / getRlmChildren / compact.

import { useCallback, useEffect, useState } from "react";
import { tokens } from "../../design/tokens";
import { Text, Card, Badge, Button, Spinner, Tabs, type BadgeTone } from "../../design";
import { useIpc } from "../../ipc/client";
import type { AgentInfo, ContextStats, RlmChild, Settings } from "../../ipc/contract";
import { GaugeIcon, LayersIcon, RefreshIcon, ZapIcon, PlugIcon, CpuIcon, LinkIcon, ShieldIcon } from "../sessions/icons";
import { formatTokens } from "../sessions/format";
import { AutonomousPanel } from "../longrunning/AutonomousPanel";
import { HeartbeatsPanel } from "../longrunning/HeartbeatsPanel";
import { SchedulesPanel } from "../longrunning/SchedulesPanel";
import { RefinementHistory } from "../longrunning/RefinementHistory";
import { GoalsPanel } from "../goals/GoalsPanel";

export function AdvancedPanel() {
  const ipc = useIpc();
  const [section, setSection] = useState<"runtime" | "longrunning">("runtime");
  const [lrTab, setLrTab] = useState("autonomous");
  const [context, setContext] = useState<ContextStats>({});
  const [children, setChildren] = useState<RlmChild[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [daemonStatus, setDaemonStatus] = useState<{ connected: boolean; tcpEnabled?: boolean; socketPath?: string }>({ connected: false });
  const [mcpServers, setMcpServers] = useState<Array<{ name: string; command: string; args?: string[]; enabled: boolean }>>([]);
  const [extensions, setExtensions] = useState<Array<{ name: string; path: string; enabled: boolean }>>([]);
  const [settings, setSettings] = useState<Settings & { mcpServers?: Array<{ name: string; command: string; args?: string[]; enabled: boolean }>; extensions?: Array<{ name: string; path: string; enabled: boolean }> }>({});
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [c, r, a, s] = await Promise.all([
        ipc.getContextStats(),
        ipc.getRlmChildren(),
        ipc.listAgents(),
        ipc.getSettings(),
      ]);
      setContext(c ?? {});
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

      // MCP servers and extensions — read from settings if available
      // The daemon owns the real config; these are surfaced from settings.json
      const extendedSettings = s as Settings & {
        mcpServers?: Array<{ name: string; command: string; args?: string[]; enabled: boolean }>;
        extensions?: Array<{ name: string; path: string; enabled: boolean }>;
      };
      const mcp = extendedSettings.mcpServers;
      if (Array.isArray(mcp)) setMcpServers(mcp);
      const ext = extendedSettings.extensions;
      if (Array.isArray(ext)) setExtensions(ext);
    } finally {
      setLoading(false);
    }
  }, [ipc]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: tokens.space.lg }}>
      {/* Section tabs: runtime telemetry vs. long-running agents (goals/
          autonomous/heartbeats/schedules/refinement). */}
      <Tabs
        variant="pill"
        items={[
          { id: "runtime", label: "Runtime telemetry" },
          { id: "longrunning", label: "Long-running" },
        ]}
        activeId={section}
        onChange={(id) => setSection(id as "runtime" | "longrunning")}
      />

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: tokens.space["3xl"] }}>
          <Spinner size={22} />
        </div>
      ) : section === "runtime" ? (
        <>
          <TrustModelCard />
          <DaemonTransportCard />
          <ContextCard context={context} onCompact={() => void ipc.compact().then(() => refresh())} />
          <RlmChildrenCard children={children} onRefresh={() => void refresh()} />
          <AgentsCard agents={agents} onAttach={(id) => void ipc.attachAgent(id).then(() => refresh())} onRefresh={() => void refresh()} />
          <DaemonDiagnosticsCard status={daemonStatus} onRefresh={() => void refresh()} />
          <McpServersCard servers={mcpServers} onChange={(next) => void ipc.setSettings({ ...settings, mcpServers: next } as Record<string, unknown>).then(() => refresh())} />
          <ExtensionsCard extensions={extensions} onChange={(next) => void ipc.setSettings({ ...settings, extensions: next } as Record<string, unknown>).then(() => refresh())} />
        </>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: tokens.space.lg }}>
          <Text variant="micro" tone="dim" uppercase style={{ letterSpacing: "0.12em" }}>
            Long-running &amp; background agents
          </Text>
          <Tabs
            variant="underline"
            items={[
              { id: "goals", label: "Goals" },
              { id: "autonomous", label: "Autonomous" },
              { id: "heartbeats", label: "Heartbeats" },
              { id: "schedules", label: "Schedules" },
              { id: "refinement", label: "Refinement" },
            ]}
            activeId={lrTab}
            onChange={setLrTab}
          />
          {lrTab === "goals" ? <GoalsPanel /> : null}
          {lrTab === "autonomous" ? <AutonomousPanel /> : null}
          {lrTab === "heartbeats" ? <HeartbeatsPanel /> : null}
          {lrTab === "schedules" ? <SchedulesPanel /> : null}
          {lrTab === "refinement" ? <RefinementHistory /> : null}
        </div>
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
    <Card variant="raised" padding="lg" style={{ display: "flex", flexDirection: "column", gap: tokens.space.md }}>
      <div style={{ display: "flex", alignItems: "center", gap: tokens.space.md }}>
        <span
          style={{
            width: 34,
            height: 34,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: tokens.radius.md,
            background: tokens.color.accentSoft,
            border: `1px solid ${tokens.color.accentBorder}`,
            color: tokens.color.accentHover,
          }}
        >
          <ShieldIcon size={16} />
        </span>
        <Text variant="label" weight="semibold">
          Trust model
        </Text>
        <Badge tone="accent">Not a sandbox</Badge>
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

// ---------------------------------------------------------------------------
// Daemon transport — TCP-loopback fallback toggle.
//
// When the Windows named-pipe transport is wedged (CreateNamedPipeW failing),
// this flips `daemonTcp` on (persisted to ~/.prime/agent/settings.json and
// honored by the Rust shell on next launch), switching the daemon IPC to TCP
// loopback. The Rust shell + bridge both read the same flag, so they always
// agree on the endpoint.
// ---------------------------------------------------------------------------

function DaemonToggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      style={{
        width: 40,
        height: 22,
        borderRadius: 0, // sharp — P4 critic fix (was 999 — a pill toggle, but spec is 0-radius)
        border: `1px solid ${tokens.color.border}`,
        background: checked ? tokens.color.accent : tokens.color.bgRaised,
        position: "relative",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
        transition: "background 120ms ease",
        padding: 0,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: checked ? 20 : 2,
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: tokens.color.text,
          transition: "left 120ms ease",
        }}
      />
    </button>
  );
}

function DaemonTransportCard() {
  const ipc = useIpc();
  const [value, setValue] = useState<boolean>(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let mounted = true;
    ipc
      .getSettings()
      .then((s) => {
        if (mounted) {
          setValue(s.daemonTcp ?? false);
          setLoaded(true);
        }
      })
      .catch(() => mounted && setLoaded(true));
    return () => {
      mounted = false;
    };
  }, [ipc]);

  const onToggle = useCallback(
    async (next: boolean) => {
      setValue(next);
      setSaving(true);
      setSaved(false);
      try {
        await ipc.setSettings({ daemonTcp: next } as Settings);
        setSaved(true);
      } finally {
        setSaving(false);
      }
    },
    [ipc],
  );

  return (
    <Card variant="raised" padding="lg" style={{ display: "flex", flexDirection: "column", gap: tokens.space.md }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: tokens.space.sm }}>
          <PlugIcon size={16} />
          <Text variant="label">Daemon transport</Text>
        </div>
        <DaemonToggle checked={value} onChange={(n) => void onToggle(n)} disabled={!loaded || saving} />
      </div>
      <Text variant="body" tone="muted">
        Uses the Windows named-pipe transport by default. If the engine fails to start (named-pipe
        creation blocked), enable TCP loopback as a fallback. Takes effect after a restart.
      </Text>
      {saved && (
        <Text variant="micro" tone="success">
          Saved. Restart the app to relaunch the engine on the selected transport.
        </Text>
      )}
      {value && (
        <Badge tone="info">TCP loopback fallback armed</Badge>
      )}
    </Card>
  );
}

function ContextCard({ context, onCompact }: { context: ContextStats; onCompact: () => void }) {
  const tokensUsed = context.tokens ?? 0;
  const ctxWindow = context.contextWindow ?? 0;
  const pct = ctxWindow > 0 ? Math.min(100, (tokensUsed / ctxWindow) * 100) : 0;

  return (
    <Card variant="raised" padding="lg" style={{ display: "flex", flexDirection: "column", gap: tokens.space.lg }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: tokens.space.md }}>
          <span
            style={{
              width: 34,
              height: 34,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: tokens.radius.md,
              background: tokens.color.accentSoft,
              border: `1px solid ${tokens.color.accentBorder}`,
              color: tokens.color.accentHover,
            }}
          >
            <GaugeIcon size={16} />
          </span>
          <Text variant="label" weight="semibold">
            Context
          </Text>
        </div>
        <Button variant="ghost" size="sm" icon={<ZapIcon size={13} />} onClick={onCompact}>
          Compact
        </Button>
      </div>

      {/* Gauge */}
      <div style={{ display: "flex", flexDirection: "column", gap: tokens.space.sm }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <Text variant="title" mono>
            {formatTokens(tokensUsed)}
          </Text>
          <Text variant="micro" tone="dim" mono>
            of {formatTokens(ctxWindow)} · {pct.toFixed(0)}%
          </Text>
        </div>
        <div
          style={{
            height: 8,
            borderRadius: tokens.radius.full,
            background: tokens.color.bgOverlay,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${pct}%`,
              borderRadius: tokens.radius.full,
              background: `linear-gradient(90deg, ${tokens.color.accent}, ${tokens.color.accentHover})`,
              transition: `width ${tokens.motion.slow} ${tokens.motion.easeOut}`,
            }}
          />
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: tokens.space.md }}>
        <Stat label="Messages" value={context.messages !== undefined ? `${context.messages}` : "—"} />
        <Stat label="Last compacted" value={context.compaction?.lastCompactedAt ? new Date(context.compaction.lastCompactedAt).toLocaleString() : "Never"} />
        <Stat label="Compaction reason" value={context.compaction?.reason ?? "—"} />
      </div>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
        padding: tokens.space.md,
        borderRadius: tokens.radius.md,
        background: tokens.color.bgElevated,
        border: `1px solid ${tokens.color.border}`,
      }}
    >
      <Text variant="micro" tone="dim" uppercase>
        {label}
      </Text>
      <Text variant="label" mono style={{ wordBreak: "break-word" }}>
        {value}
      </Text>
    </div>
  );
}

function childBadge(status: RlmChild["status"]): { label: string; tone: BadgeTone } {
  switch (status) {
    case "running":
      return { label: "Running", tone: "success" };
    case "idle":
      return { label: "Idle", tone: "neutral" };
    case "done":
      return { label: "Done", tone: "accent" };
    case "error":
      return { label: "Error", tone: "danger" };
  }
}

function RlmChildrenCard({ children, onRefresh }: { children: RlmChild[]; onRefresh: () => void }) {
  return (
    <Card variant="raised" padding="lg" style={{ display: "flex", flexDirection: "column", gap: tokens.space.lg }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: tokens.space.md }}>
          <span
            style={{
              width: 34,
              height: 34,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: tokens.radius.md,
              background: tokens.color.bgOverlay,
              border: `1px solid ${tokens.color.border}`,
              color: tokens.color.textDim,
            }}
          >
            <LayersIcon size={16} />
          </span>
          <Text variant="label" weight="semibold">
            RLM children
          </Text>
          <Badge tone="neutral">{children.length}</Badge>
        </div>
        <Button variant="ghost" size="sm" icon={<RefreshIcon size={13} />} onClick={onRefresh}>
          Refresh
        </Button>
      </div>

      {children.length === 0 ? (
        <Text variant="body" tone="dim">
          No subagents running.
        </Text>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: tokens.space.sm }}>
          {children.map((c) => {
            const b = childBadge(c.status);
            return (
              <div
                key={c.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: tokens.space.md,
                  padding: tokens.space.md,
                  borderRadius: tokens.radius.md,
                  background: tokens.color.bgElevated,
                  border: `1px solid ${tokens.color.border}`,
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background:
                      c.status === "running"
                        ? tokens.color.success
                        : c.status === "error"
                          ? tokens.color.danger
                          : c.status === "done"
                            ? tokens.color.accentHover
                            : tokens.color.textDim,
                  }}
                />
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
                  <Text variant="label" weight="medium" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {c.name ?? c.id}
                  </Text>
                  {c.summary ? (
                    <Text variant="micro" tone="dim" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {c.summary}
                    </Text>
                  ) : null}
                </div>
                <Badge tone={b.tone} dot>
                  {b.label}
                </Badge>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function agentBadge(status: AgentInfo["status"]): { label: string; tone: BadgeTone } {
  switch (status) {
    case "running":
      return { label: "Running", tone: "success" };
    case "idle":
      return { label: "Idle", tone: "neutral" };
    case "saved":
      return { label: "Saved", tone: "accent" };
  }
}

function AgentsCard({
  agents,
  onAttach,
  onRefresh,
}: {
  agents: AgentInfo[];
  onAttach: (id: string) => void;
  onRefresh: () => void;
}) {
  return (
    <Card variant="raised" padding="lg" style={{ display: "flex", flexDirection: "column", gap: tokens.space.lg }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: tokens.space.md }}>
          <span
            style={{
              width: 34,
              height: 34,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: tokens.radius.md,
              background: tokens.color.bgOverlay,
              border: `1px solid ${tokens.color.border}`,
              color: tokens.color.textDim,
            }}
          >
            <PlugIcon size={16} />
          </span>
          <Text variant="label" weight="semibold">
            Attached agents
          </Text>
          <Badge tone="neutral">{agents.length}</Badge>
        </div>
        <Button variant="ghost" size="sm" icon={<RefreshIcon size={13} />} onClick={onRefresh}>
          Refresh
        </Button>
      </div>

      {agents.length === 0 ? (
        <Text variant="body" tone="dim">
          No agents attached. Attach an agent to relay work to it.
        </Text>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: tokens.space.sm }}>
          {agents.map((a) => {
            const b = agentBadge(a.status);
            return (
              <div
                key={a.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: tokens.space.md,
                  padding: tokens.space.md,
                  borderRadius: tokens.radius.md,
                  background: tokens.color.bgElevated,
                  border: `1px solid ${tokens.color.border}`,
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background:
                      a.status === "running"
                        ? tokens.color.success
                        : a.status === "saved"
                          ? tokens.color.accentHover
                          : tokens.color.textDim,
                  }}
                />
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
                  <Text variant="label" weight="medium" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {a.name ?? a.id}
                  </Text>
                  {a.sessionId ? (
                    <Text variant="micro" tone="dim" mono>
                      session {a.sessionId}
                    </Text>
                  ) : null}
                </div>
                <Badge tone={b.tone} dot>
                  {b.label}
                </Badge>
                <Button variant="accent-soft" size="sm" icon={<PlugIcon size={12} />} onClick={() => onAttach(a.id)}>
                  Attach
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function DaemonDiagnosticsCard({ status, onRefresh }: { status: { connected: boolean; tcpEnabled?: boolean; socketPath?: string }; onRefresh: () => void }) {
  return (
    <Card variant="raised" padding="lg" style={{ display: "flex", flexDirection: "column", gap: tokens.space.lg }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: tokens.space.md }}>
          <span
            style={{
              width: 34,
              height: 34,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: tokens.radius.md,
              background: status.connected ? "rgba(133,237,117,0.12)" : "rgba(239,68,68,0.12)",
              border: `1px solid ${status.connected ? tokens.color.success : tokens.color.danger}`,
              color: status.connected ? tokens.color.success : tokens.color.danger,
            }}
          >
            <CpuIcon size={16} />
          </span>
          <Text variant="label" weight="semibold">
            Daemon diagnostics
          </Text>
          <Badge tone={status.connected ? "success" : "danger"} dot>
            {status.connected ? "Connected" : "Disconnected"}
          </Badge>
        </div>
        <Button variant="ghost" size="sm" icon={<RefreshIcon size={13} />} onClick={onRefresh}>
          Refresh
        </Button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: tokens.space.md }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: tokens.space.md, borderRadius: tokens.radius.md, background: tokens.color.bgElevated, border: `1px solid ${tokens.color.border}` }}>
          <Text variant="micro" tone="dim" uppercase>
            Daemon status
          </Text>
          <Text variant="label" mono weight="medium" style={{ color: status.connected ? tokens.color.success : tokens.color.danger }}>
            {status.connected ? "Connected" : "Disconnected"}
          </Text>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: tokens.space.md, borderRadius: tokens.radius.md, background: tokens.color.bgElevated, border: `1px solid ${tokens.color.border}` }}>
          <Text variant="micro" tone="dim" uppercase>
            TCP transport
          </Text>
          <Text variant="label" mono weight="medium">
            {status.tcpEnabled ? "Enabled" : "Disabled (Unix domain socket)"}
          </Text>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: tokens.space.md, borderRadius: tokens.radius.md, background: tokens.color.bgElevated, border: `1px solid ${tokens.color.border}` }}>
          <Text variant="micro" tone="dim" uppercase>
            Socket path
          </Text>
          <Text variant="micro" tone="dim" mono style={{ wordBreak: "break-all" }}>
            {status.socketPath ?? "—"}
          </Text>
        </div>
      </div>

      <Text variant="micro" tone="dim">
        Daemon connection is managed by the Rust shell via the Node bridge. TCP toggle (P1) will appear here when available.
      </Text>
    </Card>
  );
}

function McpServersCard({ servers, onChange }: { servers: Array<{ name: string; command: string; args?: string[]; enabled: boolean }>; onChange: (next: Array<{ name: string; command: string; args?: string[]; enabled: boolean }>) => void }) {
  return (
    <Card variant="raised" padding="lg" style={{ display: "flex", flexDirection: "column", gap: tokens.space.lg }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: tokens.space.md }}>
          <span
            style={{
              width: 34,
              height: 34,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: tokens.radius.md,
              background: tokens.color.bgOverlay,
              border: `1px solid ${tokens.color.border}`,
              color: tokens.color.textDim,
            }}
          >
            <LinkIcon size={16} />
          </span>
          <Text variant="label" weight="semibold">
            MCP servers
          </Text>
          <Badge tone="neutral">{servers.length}</Badge>
        </div>
      </div>

      {servers.length === 0 ? (
        <Text variant="body" tone="dim">
          No MCP servers configured. Add servers in settings.json under "mcpServers" or via the daemon config.
        </Text>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: tokens.space.sm }}>
          {servers.map((s, idx) => (
            <div
              key={s.name}
              style={{
                display: "flex",
                alignItems: "center",
                gap: tokens.space.md,
                padding: tokens.space.md,
                borderRadius: tokens.radius.md,
                background: tokens.color.bgElevated,
                border: `1px solid ${tokens.color.border}`,
              }}
            >
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                <div style={{ display: "flex", alignItems: "center", gap: tokens.space.sm }}>
                  <Text variant="label" weight="medium" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {s.name}
                  </Text>
                  <Badge tone={s.enabled ? "success" : "neutral"} dot>
                    {s.enabled ? "Enabled" : "Disabled"}
                  </Badge>
                </div>
                <Text variant="micro" tone="dim" mono style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {s.command} {s.args?.join(" ") ?? ""}
                </Text>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: tokens.space.sm, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={s.enabled}
                  onChange={(e) => {
                    const next = [...servers];
                    next[idx] = { ...next[idx], enabled: e.target.checked };
                    onChange(next);
                  }}
                  style={{ width: 16, height: 16, accentColor: tokens.color.accent }}
                />
                <Text variant="micro" tone="muted">Enable</Text>
              </label>
            </div>
          ))}
        </div>
      )}

      <Text variant="micro" tone="dim">
        MCP servers are configured in the daemon's settings.json. Changes here persist to settings and take effect on daemon restart.
      </Text>
    </Card>
  );
}

function ExtensionsCard({ extensions, onChange }: { extensions: Array<{ name: string; path: string; enabled: boolean }>; onChange: (next: Array<{ name: string; path: string; enabled: boolean }>) => void }) {
  return (
    <Card variant="raised" padding="lg" style={{ display: "flex", flexDirection: "column", gap: tokens.space.lg }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: tokens.space.md }}>
          <span
            style={{
              width: 34,
              height: 34,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: tokens.radius.md,
              background: tokens.color.bgOverlay,
              border: `1px solid ${tokens.color.border}`,
              color: tokens.color.textDim,
            }}
          >
            <ShieldIcon size={16} />
          </span>
          <Text variant="label" weight="semibold">
            Extensions
          </Text>
          <Badge tone="neutral">{extensions.length}</Badge>
        </div>
      </div>

      {extensions.length === 0 ? (
        <Text variant="body" tone="dim">
          No extensions configured. Add extensions in settings.json under "extensions" or place them in ~/.prime/agent/extensions/.
        </Text>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: tokens.space.sm }}>
          {extensions.map((e, idx) => (
            <div
              key={e.name}
              style={{
                display: "flex",
                alignItems: "center",
                gap: tokens.space.md,
                padding: tokens.space.md,
                borderRadius: tokens.radius.md,
                background: tokens.color.bgElevated,
                border: `1px solid ${tokens.color.border}`,
              }}
            >
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                <div style={{ display: "flex", alignItems: "center", gap: tokens.space.sm }}>
                  <Text variant="label" weight="medium" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {e.name}
                  </Text>
                  <Badge tone={e.enabled ? "success" : "neutral"} dot>
                    {e.enabled ? "Enabled" : "Disabled"}
                  </Badge>
                </div>
                <Text variant="micro" tone="dim" mono style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {e.path}
                </Text>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: tokens.space.sm, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={e.enabled}
                  onChange={(e) => {
                    const next = [...extensions];
                    next[idx] = { ...next[idx], enabled: e.target.checked };
                    onChange(next);
                  }}
                  style={{ width: 16, height: 16, accentColor: tokens.color.accent }}
                />
                <Text variant="micro" tone="muted">Enable</Text>
              </label>
            </div>
          ))}
        </div>
      )}

      <Text variant="micro" tone="dim">
        Extensions are TypeScript modules loaded by the daemon. Enable/disable here persists to settings.json and takes effect on daemon restart or /reload.
      </Text>
    </Card>
  );
}