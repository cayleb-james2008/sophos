// SystemBar — Monitor archetype: engine status, model, and context are visible
// at rest; secondary telemetry stays one click away.

import { useEffect, useRef, useState } from "react";
import { tokens } from "../design/tokens";
import { Text, Tooltip, IconButton } from "../design";
import { useConnectionState, useIpc } from "../ipc/client";
import type { AgentInfo } from "../ipc/contract";
import { useRefinementGate } from "../features/longrunning/useRefinementGate";
import { ChevronDownIcon, TerminalIcon, SigmaGlyph } from "./icons";

function statusKind(status: { kind: string }): "connecting" | "connected" | "disconnected" | "reconnecting" {
  switch (status.kind) {
    case "connecting": return "connecting";
    case "connected": return "connected";
    case "reconnecting": return "reconnecting";
    default: return "disconnected";
  }
}

function statusLabel(kind: string): string {
  switch (kind) {
    case "connected": return "Engine live";
    case "connecting": return "Connecting";
    case "reconnecting": return "Reconnecting";
    default: return "Engine offline";
  }
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k`;
  return `${n}`;
}

function truncatePath(path: string, max = 30): string {
  if (path.length <= max) return path;
  const head = path.slice(0, Math.max(1, Math.floor(max * 0.4)));
  const tail = path.slice(-Math.max(1, Math.floor(max * 0.6)));
  return `${head}…${tail}`;
}

function formatCost(value?: number): string {
  return typeof value === "number" && Number.isFinite(value) ? `$${value.toFixed(2)}` : "—";
}

function DetailRow({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="system-bar__detail-row">
      <Text variant="micro" tone="dim" mono uppercase>
        {label}
      </Text>
      <Text variant="micro" tone={accent ? "accent" : "muted"} mono className="system-bar__detail-value">
        {value}
      </Text>
    </div>
  );
}

export function SystemBar({ engineOpen, onToggleEngine }: { engineOpen: boolean; onToggleEngine: () => void }) {
  const state = useConnectionState();
  const ipc = useIpc();
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [cwd, setCwd] = useState<string | undefined>();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsRef = useRef<HTMLDivElement | null>(null);
  const activeSessionId = state.activeSessionId;

  useEffect(() => {
    let mounted = true;
    ipc.listAgents().then((items) => mounted && setAgents(items ?? [])).catch(() => {});
    const unsubscribe = ipc.onEvent((event) => {
      if (event.type === "agent_list") setAgents(event.agents);
      if (event.type === "agent_status") {
        setAgents((old) => [...old.filter((item) => item.id !== event.agent.id), event.agent]);
      }
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [ipc]);

  useEffect(() => {
    let mounted = true;
    ipc.listSessions().then((sessions) => {
      if (!mounted) return;
      setCwd(sessions.find((session) => session.id === activeSessionId)?.cwd);
    }).catch(() => mounted && setCwd(undefined));
    return () => { mounted = false; };
  }, [ipc, activeSessionId]);

  useEffect(() => {
    if (!detailsOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!detailsRef.current?.contains(event.target as Node)) setDetailsOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDetailsOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [detailsOpen]);

  const kind = statusKind(state.status);
  const label = statusLabel(kind);
  const model = state.model?.model ?? "no model";
  const provider = state.model?.provider ?? "—";
  const tokensUsed = state.context?.tokens ?? 0;
  const contextWindow = state.context?.contextWindow ?? 0;
  const pct = contextWindow > 0 ? Math.min(100, Math.round((tokensUsed / contextWindow) * 100)) : 0;
  const autoActive = state.autonomousConfig?.active ?? false;
  const autoBudget = state.autonomousConfig
    ? [
        state.autonomousConfig.maxTurns != null ? `${state.autonomousConfig.maxTurns} turns` : null,
        state.autonomousConfig.maxTokens != null ? `${formatTokens(state.autonomousConfig.maxTokens)} tok` : null,
        state.autonomousConfig.maxTime ? state.autonomousConfig.maxTime : null,
      ].filter((value): value is string => Boolean(value)).join(" · ")
    : "";
  const gate = useRefinementGate();
  const refinePending = gate.pending != null;
  const runningAgents = agents.filter((agent) => agent.status === "running").length;
  const cost = state.costStats;

  return (
    <header className="system-bar">
      <div className="system-bar__brand">
        <span className="system-bar__mark" aria-hidden="true"><SigmaGlyph size={14} /></span>
        <span className="system-bar__wordmark">SOPHOS</span>
        <span className="system-bar__divider" aria-hidden="true" />
        <span className="system-bar__platform">Windows</span>
      </div>

      <div key={`${kind}:${model}:${provider}:${tokensUsed}:${pct}:${cost?.sessionCost ?? ""}`} className="system-bar__readout system-bar__readout--updated" aria-label="Engine status">
        <Tooltip content={label} side="bottom">
          <div className="system-bar__cell">
            <span className={`system-bar__dot system-bar__dot--${kind}`} aria-hidden="true" />
            <span className="system-bar__label">Engine</span>
            <span className="system-bar__value">{label}</span>
          </div>
        </Tooltip>
        <div className="system-bar__cell">
          <span className="system-bar__label">Model</span>
          <span className="system-bar__value" title={`${model} / ${provider}`}>{model}</span>
        </div>
        <Tooltip content={`Context ${formatTokens(tokensUsed)} / ${formatTokens(contextWindow)}`} side="bottom">
          <div className="system-bar__cell">
            <span className="system-bar__label">Context</span>
            <span className="system-bar__context-track" aria-hidden="true">
              <span className={`system-bar__context-fill system-bar__context-fill--${Math.min(100, Math.round(pct / 5) * 5)}${pct > 85 ? " system-bar__context-fill--warn" : ""}`} />
            </span>
            <span className="system-bar__value">{pct}%</span>
          </div>
        </Tooltip>
        <Tooltip content={cost ? `Session ${formatCost(cost.sessionCost)} · ${formatTokens((cost.inputTokens ?? 0) + (cost.outputTokens ?? 0))} tokens` : "No cost data yet"} side="bottom">
          <div className="system-bar__cell system-bar__cell--cost" aria-label="Session cost">
            <span className="system-bar__label">Cost</span>
            <span className="system-bar__cost-value">{formatCost(cost?.sessionCost)}</span>
            {cost ? (
              <span className="system-bar__cost-tokens">{formatTokens((cost.inputTokens ?? 0) + (cost.outputTokens ?? 0))}</span>
            ) : null}
          </div>
        </Tooltip>
      </div>

      {(autoActive || refinePending) ? (
        <div className="system-bar__alerts">
          {autoActive ? <span className="system-bar__alert"><span className="system-bar__alert-dot" />AUTO</span> : null}
          {refinePending ? <span className="system-bar__alert"><span className="system-bar__alert-dot" />REFINE</span> : null}
        </div>
      ) : null}

      <div className="system-bar__actions" ref={detailsRef}>
        <button
          type="button"
          className="system-bar__details-button pa-focus-ring"
          aria-expanded={detailsOpen}
          aria-label="Session details"
          onClick={() => setDetailsOpen((open) => !open)}
        >
          Details
          <span className={`system-bar__chevron${detailsOpen ? " system-bar__chevron--open" : ""}`}><ChevronDownIcon size={11} color="currentColor" /></span>
        </button>
        <Tooltip content={engineOpen ? "Hide engine terminal" : "Show engine terminal"} side="bottom">
          <IconButton title={engineOpen ? "Hide engine terminal" : "Show engine terminal"} onClick={onToggleEngine} tone={engineOpen ? "accent" : "default"} size="sm">
            <TerminalIcon size={15} color={engineOpen ? tokens.color.accentHover : tokens.color.textDim} />
          </IconButton>
        </Tooltip>

        {detailsOpen ? (
          <>
            <div className="system-bar__scrim" aria-hidden="true" onClick={() => setDetailsOpen(false)} />
            <div className="system-bar__details-panel" role="dialog" aria-label="Session details">
              <DetailRow label="Agents" value={`${runningAgents} live`} accent={runningAgents > 0} />
              <DetailRow label="Directory" value={cwd ? truncatePath(cwd, 34) : "—"} />
              <DetailRow label="Context" value={`${formatTokens(tokensUsed)} / ${formatTokens(contextWindow)} · ${pct}%`} />
              <DetailRow label="Session cost" value={formatCost(cost?.sessionCost)} />
              {cost?.totalCost != null ? <DetailRow label="Total cost" value={formatCost(cost.totalCost)} /> : null}
              <DetailRow label="Autonomous" value={autoActive ? autoBudget || "active" : "off"} accent={autoActive} />
              <DetailRow label="Refinement" value={refinePending ? "awaiting review" : "none pending"} accent={refinePending} />
            </div>
          </>
        ) : null}
      </div>
    </header>
  );
}
