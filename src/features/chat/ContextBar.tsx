// ContextBar — a compact usage/context strip shown between the message list
// and the composer. Displays token count, context window, and message count
// from ContextStats (ipc.getContextStats / context_stats|usage events).

import { Text } from "../../design";
import type { ContextStats } from "../../ipc/contract";
import type { CSSProperties } from "react";

function fmt(n: number | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}k`;
  return String(n);
}

export function ContextBar({ stats }: { stats: ContextStats | null }) {
  const tokensN = stats?.tokens;
  const windowN = stats?.contextWindow;
  const messagesN = stats?.messages;

  const percent =
    typeof tokensN === "number" &&
    typeof windowN === "number" &&
    Number.isFinite(windowN) &&
    windowN > 0
      ? Math.min(100, (tokensN / windowN) * 100)
      : undefined;

  return (
    <div className="context-bar">
      <div className="context-bar-inner">
        <Text variant="micro" tone="dim" mono uppercase>
          context
        </Text>
        <Text variant="micro" tone="muted" mono>
          {fmt(tokensN)} tokens
        </Text>
        <Text variant="micro" tone="dim" mono>
          / {fmt(windowN)}
        </Text>
        {percent !== undefined ? (
          <div
            role="progressbar"
            aria-label="Context usage"
            aria-valuenow={Math.round(percent)}
            aria-valuemin={0}
            aria-valuemax={100}
            title={`${percent.toFixed(1)}% of context window`}
            className="context-bar-meter"
          >
            <div
              className={`context-bar-meter-fill${percent > 80 ? " context-bar-meter-fill--warn" : ""}`}
              style={{ "--ctx": `${percent}%` } as CSSProperties}
            />
          </div>
        ) : null}
        <div className="context-bar-spacer" />
        <Text variant="micro" tone="muted" mono>
          {fmt(messagesN)} messages
        </Text>
      </div>
    </div>
  );
}
