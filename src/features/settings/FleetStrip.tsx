// FleetStrip — a live command-center readout across the top of Settings:
// running agents, total context tokens, and provider connectivity. Wired to
// listAgents / getContextStats / getProviders.

import { useEffect, useState } from "react";
import { useIpc, useConnectionState } from "../../ipc/client";
import type { AgentInfo, ContextStats, ProviderInfo } from "../../ipc/contract";
import { formatTokens } from "../sessions/format";

export function FleetStrip() {
  const ipc = useIpc();
  const conn = useConnectionState();
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [context, setContext] = useState<ContextStats>({});
  const [providers, setProviders] = useState<ProviderInfo[]>([]);

  useEffect(() => {
    let mounted = true;
    Promise.all([ipc.listAgents(), ipc.getContextStats(), ipc.getProviders()])
      .then(([a, c, p]) => {
        if (mounted) {
          setAgents(a ?? []);
          setContext(c ?? {});
          setProviders(p ?? []);
        }
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [ipc]);

  const running = agents.filter((a) => a.status === "running").length;
  const connected = providers.filter((p) => p.connected).length;
  const tokens = context.tokens ?? 0;
  const ctxWindow = context.contextWindow ?? 0;
  const pct = ctxWindow > 0 ? Math.min(100, Math.round((tokens / ctxWindow) * 100)) : 0;
  const model = conn.model?.model ?? "—";

  return (
    <div className="fleet">
      <div className="fleet__cell">
        <label>Agents live</label>
        <b>
          {running} <small>/ {agents.length}</small>
        </b>
      </div>
      <div className="fleet__cell">
        <label>Context tokens</label>
        <b>
          {formatTokens(tokens)} <small>· {pct}%</small>
        </b>
      </div>
      <div className="fleet__cell">
        <label>Providers</label>
        <b>
          {connected} <small>/ {providers.length} connected</small>
        </b>
      </div>
      <div className="fleet__cell">
        <label>Model</label>
        <b>{model}</b>
      </div>
    </div>
  );
}
