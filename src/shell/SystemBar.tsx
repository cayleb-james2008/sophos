// SystemBar — the live engine-telemetry strip. THE signature element of the
// Sophos frame. Reads directly from the IPC connection state + agent list so
// it is genuinely live, not decoration.
//
// Density doctrine (vision-critic defect D17, 2026-08-09): the reference
// (primeintellect.ai) is stark and editorial, not a flight-deck instrument.
// Nine adjacent segmented cells read as a cockpit, so the bar now shows only
// what a user must see at a glance:
//
//   ALWAYS   engine status · model · context %
//   ALERTS   AUTO / REFINE — surfaced inline ONLY while they demand attention
//            (autonomous running, refinement awaiting review); silent otherwise
//   DETAILS  agents · cwd · full context tokens · cost breakdown — behind a
//            single toggle, one click away
//
// Nothing was removed from the product; secondary telemetry moved one click
// away so the resting state is calm.

import { useEffect, useRef, useState } from "react";
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

/**
 * One line of secondary telemetry inside the Details panel. Ruled with a
 * hairline rather than boxed — the reference uses borders as the divider, not
 * nested cards.
 */
function DetailRow({
  label,
  value,
  title,
  accent,
  last,
}: {
  label: string;
  value: string;
  title?: string;
  accent?: boolean;
  last?: boolean;
}) {
  return (
    <div
      title={title}
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: tokens.space.xl,
        padding: `8px ${tokens.space.md}`,
        borderBottom: last ? "none" : `1px solid ${tokens.color.border}`,
        whiteSpace: "nowrap",
      }}
    >
      <Text variant="micro" tone="dim" mono uppercase style={{ letterSpacing: "0.08em" }}>
        {label}
      </Text>
      <Text variant="micro" tone={accent ? "accent" : "muted"} mono style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
        {value}
      </Text>
    </div>
  );
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
  // Cost accounting is rendered as discrete rows in the Details panel, so no
  // hover-title summary string is needed here any more.
  const cost = state.costStats;

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

  // Secondary telemetry lives behind a toggle (D17). Close on outside click and
  // on Escape so it never traps focus.
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!detailsOpen) return;
    const onDown = (e: MouseEvent) => {
      if (detailsRef.current && !detailsRef.current.contains(e.target as Node)) setDetailsOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setDetailsOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [detailsOpen]);

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

        {/* Context usage — the percentage only; the token counts live in Details */}
        <Tooltip content={`Context ${formatTokens(tokensUsed)} / ${formatTokens(window)}`} side="bottom">
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
            <span
              style={{
                position: "relative",
                width: 52,
                height: 4,
                background: tokens.color.surface2,
                borderRadius: 0,
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
        </Tooltip>
      </div>

      {/* Attention-only alerts. Autonomous and refinement are silent while idle
          and only claim space in the bar when they genuinely need the user
          (D4/D17: green is a signal, not decoration). */}
      {(autoActive || refinePending) && (
        <div style={{ display: "flex", alignItems: "center", gap: tokens.space.sm, flexShrink: 0 }}>
          {autoActive && (
            <Tooltip content={`Autonomous active${autoBudget ? ` · ${autoBudget}` : ""}`} side="bottom">
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: tokens.space.sm,
                  padding: "5px 10px",
                  border: `1px solid ${tokens.color.accentBorder}`,
                  background: tokens.color.accentSoft,
                  whiteSpace: "nowrap",
                }}
              >
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: tokens.color.accent, flexShrink: 0 }} />
                <Text variant="micro" tone="accent" mono uppercase style={{ letterSpacing: "0.08em" }}>
                  AUTO
                </Text>
              </div>
            </Tooltip>
          )}
          {refinePending && (
            <Tooltip content="Refinement awaiting your review" side="bottom">
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: tokens.space.sm,
                  padding: "5px 10px",
                  border: `1px solid ${tokens.color.accentBorder}`,
                  background: tokens.color.accentSoft,
                  whiteSpace: "nowrap",
                }}
              >
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: tokens.color.accent, flexShrink: 0 }} />
                <Text variant="micro" tone="accent" mono uppercase style={{ letterSpacing: "0.08em" }}>
                  REFINE
                </Text>
              </div>
            </Tooltip>
          )}
        </div>
      )}

      {/* Right cluster: details toggle + engine toggle */}
      <div style={{ display: "flex", alignItems: "center", gap: tokens.space.md, flexShrink: 0 }}>
        {/* Secondary telemetry — one click away, not always on screen (D17) */}
        <div ref={detailsRef} style={{ position: "relative" }}>
          <Tooltip content={detailsOpen ? "Hide details" : "Session details — agents, directory, cost"} side="bottom">
            <button
              type="button"
              aria-expanded={detailsOpen}
              aria-label="Session details"
              onClick={() => setDetailsOpen((v) => !v)}
              className="pa-focus-ring"
              style={{
                display: "flex",
                alignItems: "center",
                gap: tokens.space.sm,
                padding: "5px 10px",
                background: detailsOpen ? tokens.color.surface2 : "transparent",
                border: `1px solid ${detailsOpen ? tokens.color.borderStrong : tokens.color.border}`,
                borderRadius: tokens.radius.sm,
                cursor: "pointer",
                whiteSpace: "nowrap",
                transition: `background ${tokens.motion.fast} ${tokens.motion.ease}`,
              }}
            >
              <Text variant="micro" tone={detailsOpen ? "default" : "dim"} mono uppercase style={{ letterSpacing: "0.08em" }}>
                Details
              </Text>
              <span
                style={{
                  display: "inline-flex",
                  transform: detailsOpen ? "rotate(180deg)" : "none",
                  transition: `transform ${tokens.motion.fast} ${tokens.motion.ease}`,
                }}
              >
                <ChevronDownIcon size={11} color={detailsOpen ? tokens.color.text : tokens.color.textDim} />
              </span>
            </button>
          </Tooltip>

          {detailsOpen && (
            <div
              role="dialog"
              aria-label="Session details"
              style={{
                position: "absolute",
                top: "calc(100% + 8px)",
                right: 0,
                minWidth: 300,
                background: tokens.color.bgOverlay,
                border: `1px solid ${tokens.color.border}`,
                borderRadius: tokens.radius.sm,
                zIndex: 40,
                display: "flex",
                flexDirection: "column",
              }}
            >
              <DetailRow label="Agents" value={`${runningAgents} live`} accent={runningAgents > 0} />
              <DetailRow label="Directory" value={cwd ? truncatePath(cwd, 34) : "—"} title={cwd ?? "No working directory"} />
              <DetailRow label="Context" value={`${formatTokens(tokensUsed)} / ${formatTokens(window)} · ${pct}%`} />
              <DetailRow label="Session cost" value={formatCost(cost?.sessionCost)} />
              {cost?.totalCost != null && <DetailRow label="Total cost" value={formatCost(cost.totalCost)} />}
              {(cost?.inputTokens != null || cost?.outputTokens != null) && (
                <DetailRow
                  label="Tokens"
                  value={`${formatTokens(cost?.inputTokens ?? 0)} in / ${formatTokens(cost?.outputTokens ?? 0)} out`}
                />
              )}
              <DetailRow label="Autonomous" value={autoActive ? autoBudget || "active" : "off"} accent={autoActive} />
              <DetailRow label="Refinement" value={refinePending ? "awaiting review" : "none pending"} accent={refinePending} last />
            </div>
          )}
        </div>

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
      </div>
    </header>
  );
}
