// SystemBar — the live engine-telemetry strip. THE signature element of the
// Sophos frame: a thin, always-visible readout of the engine's live state
// (daemon status with a pulsing dot, active agents, model, context usage).
// Reads directly from the IPC connection state + agent list so it is
// genuinely live, not decoration.

import { useEffect, useState } from "react";
import { tokens } from "../design/tokens";
import { Text, Tooltip, IconButton } from "../design";
import { useConnectionState, useIpc } from "../ipc/client";
import type { AgentInfo } from "../ipc/contract";
import { useRefinementGate } from "../features/longrunning/useRefinementGate";
import { ChevronDownIcon, TerminalIcon, SigmaGlyph } from "./icons";

function statusKind(status: { kind: string }): "connecting" | "connected" | "disconnected" | "reconnecting" {
  switch (status.kind) {
    case "connecting":
      return "connecting";
    case "connected":
      return "connected";
    case "disconnected":
      return "disconnected";
    case "reconnecting":
      return "reconnecting";
    default:
      return "disconnected";
  }
}

function statusColor(kind: string): string {
  switch (kind) {
    case "connected":
      return tokens.color.ok;
    case "connecting":
    case "reconnecting":
      return tokens.color.warn;
    case "disconnected":
      return tokens.color.err;
    default:
      return tokens.color.muted;
  }
}

function statusLabel(kind: string): string {
  switch (kind) {
    case "connected":
      return "Engine Live";
    case "connecting":
      return "Connecting";
    case "reconnecting":
      return "Reconnecting";
    case "disconnected":
      return "Engine Offline";
    default:
      return "Engine Idle";
  }
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k`;
  return `${n}`;
}

/** Truncate a path in the middle so the tail (the meaningful part) stays visible. */
function truncatePath(p: string, max = 30): string {
  if (p.length <= max) return p;
  const head = p.slice(0, Math.max(1, Math.floor(max * 0.4)));
  const tail = p.slice(-Math.max(1, Math.floor(max * 0.6)));
  return `${head}…${tail}`;
}

function formatCost(n?: number): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return `$${n.toFixed(2)}`;
}

export function SystemBar({ engineOpen, onToggleEngine }: { engineOpen: boolean; onToggleEngine: () => void }) {
  const state = useConnectionState();
  const ipc = useIpc();
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [cwd, setCwd] = useState<string | undefined>(undefined);
  const activeSessionId = state.activeSessionId;

  // Live agent count — refresh on mount and on agent_list / agent_status events.
  useEffect(() => {
    let mounted = true;
    ipc
      .listAgents()
      .then((a) => mounted && setAgents(a ?? []))
      .catch(() => {});
    const un = ipc.onEvent((event) => {
      if (event.type === "agent_list") setAgents(event.agents);
      if (event.type === "agent_status") {
        setAgents((old) => [...old.filter((x) => x.id !== event.agent.id), event.agent]);
      }
    });
    return () => {
      mounted = false;
      un();
    };
  }, [ipc]);

  // Current working directory — resolved from the active session (research F3).
  // The contract carries cwd on SessionInfo (listSessions), not on the state
  // snapshot, so we match the active session id against the session list.
  useEffect(() => {
    let mounted = true;
    ipc
      .listSessions()
      .then((sessions) => {
        if (!mounted) return;
        const active = sessions.find((s) => s.id === activeSessionId);
        setCwd(active?.cwd);
      })
      .catch(() => {
        if (mounted) setCwd(undefined);
      });
    return () => {
      mounted = false;
    };
  }, [ipc, activeSessionId]);

  const kind = statusKind(state.status);
  const color = statusColor(kind);
  const label = statusLabel(kind);
  const runningAgents = agents.filter((a) => a.status === "running").length;
  const model = state.model?.model ?? "no model";
  const provider = state.model?.provider ?? "—";
  const tokensUsed = state.context?.tokens ?? 0;
  const window = state.context?.contextWindow ?? 0;
  const pct = window > 0 ? Math.min(100, Math.round((tokensUsed / window) * 100)) : 0;
  const cost = state.costStats;
  const costTitle = [
    cost?.sessionCost != null ? `Session ${formatCost(cost.sessionCost)}` : null,
    cost?.totalCost != null ? `Total ${formatCost(cost.totalCost)}` : null,
    cost?.inputTokens != null || cost?.outputTokens != null
      ? `${formatTokens(cost.inputTokens ?? 0)} in / ${formatTokens(cost.outputTokens ?? 0)} out`
      : null,
  ]
    .filter((x): x is string => Boolean(x))
    .join(" · ");

  // A4: always-visible autonomous + refine indicators (terminal green = active).
  const autoActive = state.autonomousConfig?.active ?? false;
  const autoBudget = state.autonomousConfig
    ? [
        state.autonomousConfig.maxTurns != null ? `${state.autonomousConfig.maxTurns} turns` : null,
        state.autonomousConfig.maxTokens != null ? `${(state.autonomousConfig.maxTokens / 1000).toFixed(0)}k tok` : null,
        state.autonomousConfig.maxTime ? `${state.autonomousConfig.maxTime}` : null,
      ]
        .filter((x): x is string => Boolean(x))
        .join(" · ")
    : null;
  const gate = useRefinementGate();
  const refinePending = gate.pending != null;

  return (
    <header
      style={{
        height: tokens.layout.headerH,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: `0 ${tokens.space.lg}`,
        background: tokens.color.bgElevated,
        borderBottom: `1px solid ${tokens.color.border}`,
        flexShrink: 0,
        position: "relative",
        zIndex: 10,
        gap: tokens.space.lg,
      }}
    >
      {/* Monochrome brand anchor */}
      <div style={{ display: "flex", alignItems: "center", gap: tokens.space.md, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: tokens.space.sm }}>
          <span
            style={{
              width: 20,
              height: 20,
              borderRadius: tokens.radius.sm,
              background: tokens.color.surface2,
              border: `1px solid ${tokens.color.border}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <SigmaGlyph size={13} />
          </span>
          <Text
            as="span"
            style={{ fontFamily: tokens.font.display, fontSize: 15, fontWeight: 600, letterSpacing: "0.04em", color: tokens.color.text }}
          >
            SOPHOS
          </Text>
        </div>
        <span style={{ width: 1, height: 16, background: tokens.color.borderStrong }} />
        <Text variant="micro" tone="dim" mono uppercase style={{ letterSpacing: "0.1em" }}>
          Sophos // Windows
        </Text>
      </div>

      {/* Live telemetry readout — the signature strip */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 0,
          border: `1px solid ${tokens.color.border}`,
          borderRadius: tokens.radius.md,
          background: tokens.color.bg,
          overflow: "hidden",
          flexShrink: 1,
          minWidth: 0,
        }}
      >
        {/* Engine status with live pulse */}
        <Tooltip content={label} side="bottom">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: tokens.space.sm,
              padding: "6px 12px",
              borderRight: `1px solid ${tokens.color.border}`,
              whiteSpace: "nowrap",
            }}
          >
            <span
              style={{
                position: "relative",
                width: 8,
                height: 8,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <span
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: "50%",
                  background: color,
                  animation: kind === "connected" || kind === "connecting" ? "pa-beat 1.6s cubic-bezier(0,0,0.2,1) infinite" : undefined,
                  opacity: 0.35,
                }}
              />
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
            </span>
            <Text variant="micro" tone="muted" mono uppercase style={{ letterSpacing: "0.08em" }}>
              {label}
            </Text>
          </div>
        </Tooltip>

        {/* Active agents */}
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: tokens.space.sm,
            padding: "6px 12px",
            borderRight: `1px solid ${tokens.color.border}`,
            whiteSpace: "nowrap",
          }}
        >
          <Text variant="micro" tone="dim" mono uppercase style={{ letterSpacing: "0.08em" }}>
            Agents
          </Text>
          <span style={{ fontFamily: tokens.font.display, fontSize: 14, fontWeight: 600, color: runningAgents > 0 ? tokens.color.accent : tokens.color.text, lineHeight: 1 }}>
            {runningAgents}
          </span>
          <Text variant="micro" tone="dim" mono>
            live
          </Text>
        </div>

        {/* Model */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: tokens.space.sm,
            padding: "6px 12px",
            borderRight: `1px solid ${tokens.color.border}`,
            whiteSpace: "nowrap",
            minWidth: 0,
          }}
        >
          <Text variant="micro" tone="dim" mono uppercase style={{ letterSpacing: "0.08em" }}>
            Model
          </Text>
          <Text variant="micro" tone="muted" mono style={{ maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis" }}>
            {model}
          </Text>
          <Text variant="micro" tone="dim" mono>
            / {provider}
          </Text>
        </div>

        {/* Current working directory (research F3) — truncated, full path on hover */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: tokens.space.sm,
            padding: "6px 12px",
            borderRight: `1px solid ${tokens.color.border}`,
            whiteSpace: "nowrap",
            minWidth: 0,
          }}
        >
          <Text variant="micro" tone="dim" mono uppercase style={{ letterSpacing: "0.08em" }}>
            CWD
          </Text>
          <span title={cwd ?? "No working directory"} style={{ display: "inline-flex", minWidth: 0 }}>
            <Text
              variant="micro"
              tone="muted"
              mono
              style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis" }}
            >
              {cwd ? truncatePath(cwd) : "—"}
            </Text>
          </span>
        </div>

        {/* Autonomous — always-visible opt-in indicator (A4) */}
        <Tooltip content={autoActive ? `Autonomous active${autoBudget ? ` · ${autoBudget}` : ""}` : "Autonomous off — opt-in"} side="bottom">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: tokens.space.sm,
              padding: "6px 12px",
              borderRight: `1px solid ${tokens.color.border}`,
              whiteSpace: "nowrap",
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: autoActive ? tokens.color.accent : tokens.color.textDim,
                flexShrink: 0,
              }}
            />
            <Text variant="micro" tone={autoActive ? "accent" : "dim"} mono uppercase style={{ letterSpacing: "0.08em" }}>
              AUTO
            </Text>
          </div>
        </Tooltip>

        {/* Refine — always-visible review-gate indicator (A1/A4) */}
        <Tooltip content={refinePending ? "Refinement awaiting your review" : "No refinement pending"} side="bottom">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: tokens.space.sm,
              padding: "6px 12px",
              borderRight: `1px solid ${tokens.color.border}`,
              whiteSpace: "nowrap",
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: refinePending ? tokens.color.accent : tokens.color.textDim,
                flexShrink: 0,
              }}
            />
            <Text variant="micro" tone={refinePending ? "accent" : "dim"} mono uppercase style={{ letterSpacing: "0.08em" }}>
              REFINE
            </Text>
          </div>
        </Tooltip>

        {/* Context usage */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: tokens.space.sm,
            padding: "6px 12px",
            whiteSpace: "nowrap",
          }}
        >
          <Text variant="micro" tone="dim" mono uppercase style={{ letterSpacing: "0.08em" }}>
            Ctx
          </Text>
          <Text variant="micro" tone="muted" mono>
            {formatTokens(tokensUsed)}/{formatTokens(window)}
          </Text>
          <span
            style={{
              position: "relative",
              width: 52,
              height: 4,
              background: tokens.color.surface2,
              borderRadius: 0, // sharp — P2 critic fix
              overflow: "hidden",
            }}
          >
            <span
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                width: `${pct}%`,
                background: pct > 85 ? tokens.color.warn : tokens.color.accent,
                transition: `width ${tokens.motion.base} ${tokens.motion.ease}`,
              }}
            />
          </span>
          <Text variant="micro" tone="dim" mono>
            {pct}%
          </Text>
        </div>

        {/* Session cost (research F4) — session cost, full accounting on hover */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: tokens.space.sm,
            padding: "6px 12px",
            whiteSpace: "nowrap",
          }}
        >
          <Text variant="micro" tone="dim" mono uppercase style={{ letterSpacing: "0.08em" }}>
            Cost
          </Text>
          <span title={costTitle || "No cost data"}>
            <Text variant="micro" tone="muted" mono>
              {formatCost(cost?.sessionCost)}
            </Text>
          </span>
        </div>
      </div>

      {/* Right cluster: engine toggle */}
      <div style={{ display: "flex", alignItems: "center", gap: tokens.space.md, flexShrink: 0 }}>
        <Tooltip content={engineOpen ? "Hide engine terminal" : "Show engine terminal"} side="bottom">
          <IconButton
            title={engineOpen ? "Hide engine terminal" : "Show engine terminal"}
            onClick={onToggleEngine}
            tone={engineOpen ? "accent" : "default"}
            size="sm"
          >
            <TerminalIcon size={15} color={engineOpen ? tokens.color.accentHover : tokens.color.textDim} />
          </IconButton>
        </Tooltip>
        <ChevronDownIcon size={12} color={tokens.color.textDim} />
      </div>
    </header>
  );
}
