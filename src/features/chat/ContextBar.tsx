// ContextBar — a compact usage/context strip shown between the message list
// and the composer. Displays token count, context window, and message count
// from ContextStats (ipc.getContextStats / context_stats|usage events).

import { tokens } from "../../design/tokens";
import { Text } from "../../design";
import type { ContextStats } from "../../ipc/contract";

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
    <div
      style={{
        flexShrink: 0,
        padding: `${tokens.space.sm} ${tokens.space.xl}`,
        borderTop: `1px solid ${tokens.color.border}`,
        background: `linear-gradient(180deg, ${tokens.color.bgElevated}66, transparent)`,
      }}
    >
      <div
        style={{
          maxWidth: tokens.layout.maxContentW,
          margin: "0 auto",
          display: "flex",
          alignItems: "center",
          gap: tokens.space.md,
        }}
      >
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
            style={{
              width: 96,
              height: 4,
              borderRadius: tokens.radius.full,
              background: tokens.color.bgOverlay,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${percent}%`,
                borderRadius: tokens.radius.full,
                background: percent > 80 ? tokens.color.warning : percent > 50 ? tokens.color.accent : tokens.color.success,
              }}
            />
          </div>
        ) : null}
        <div style={{ flex: 1 }} />
        <Text variant="micro" tone="muted" mono>
          {fmt(messagesN)} messages
        </Text>
      </div>
    </div>
  );
}
