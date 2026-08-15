// ContextPanel — context/statistics card (tokens, context window, compaction).

import { Text, Card, Button } from "../../design";
import type { ContextStats } from "../../ipc/contract";
import { GaugeIcon, ZapIcon } from "../sessions/icons";
import { formatTokens } from "../sessions/format";
import type { CSSProperties } from "react";

export function ContextPanel({ context, onCompact }: { context: ContextStats; onCompact: () => void }) {
  const tokensUsed = context.tokens ?? 0;
  const ctxWindow = context.contextWindow ?? 0;
  const pct = ctxWindow > 0 ? Math.min(100, (tokensUsed / ctxWindow) * 100) : 0;

  return (
    <Card variant="raised" padding="lg" className="card-stack">
      <div className="sp-head">
        <div className="sp-headleft">
          <span className="sp-icon">
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
      <div className="sp-gauge">
        <div className="sp-gaugehead">
          <Text variant="title" mono>
            {formatTokens(tokensUsed)}
          </Text>
          <Text variant="micro" tone="dim" mono>
            of {formatTokens(ctxWindow)} · {pct.toFixed(0)}%
          </Text>
        </div>
        <div className="sp-meter">
          <div
            className="sp-meterfill"
            style={{ "--w": `${pct}%` } as CSSProperties}
          />
        </div>
      </div>

      {/* Stats */}
      <div className="sp-grid3">
        <Stat label="Messages" value={context.messages !== undefined ? `${context.messages}` : "—"} />
        <Stat label="Last compacted" value={context.compaction?.lastCompactedAt ? new Date(context.compaction.lastCompactedAt).toLocaleString() : "Never"} />
        <Stat label="Compaction reason" value={context.compaction?.reason ?? "—"} />
      </div>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="sp-stat">
      <Text variant="micro" tone="dim" uppercase>
        {label}
      </Text>
      <Text variant="label" mono className="sp-statval">
        {value}
      </Text>
    </div>
  );
}
