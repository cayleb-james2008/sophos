// ContextPanel — the popover panel rendered when the ContextBar is clicked.
// Shows the token breakdown (tokens total, context window, messages count),
// compaction history (lastCompactedAt + reason from stats.compaction), and a
// "Compact Now" button that calls ipc.compact() with a transient "Compacting…"
// state. Close on Escape + outside click (matching the SystemBar details
// panel pattern with a scrim).

import { useEffect, useRef, useState } from "react";
import { Text, Button } from "../../design";
import type { ContextStats } from "../../ipc/contract";

function fmt(n: number | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}k`;
  return String(n);
}

function fmtDate(iso: string | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString();
  } catch {
    return "—";
  }
}

interface ContextPanelProps {
  stats: ContextStats | null;
  onCompact?: (prompt?: string) => Promise<void>;
  onClose: () => void;
}

function PanelRow({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="context-panel__row">
      <Text variant="micro" tone="dim" mono uppercase>
        {label}
      </Text>
      <Text variant="micro" tone={accent ? "warning" : "muted"} mono className="context-panel__value">
        {value}
      </Text>
    </div>
  );
}

export function ContextPanel({ stats, onCompact, onClose }: ContextPanelProps) {
  const [compacting, setCompacting] = useState(false);
  const [compactError, setCompactError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Escape + outside-click to close. The scrim handles outside-click visually.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const handleCompact = () => {
    if (!onCompact || compacting) return;
    setCompactError(null);
    setCompacting(true);
    // Call compact, then close the panel after a brief delay so the
    // "Compacting…" state is visible.
    void onCompact()
      .then(() => {
        // Brief delay to let the transient state register, then close.
        window.setTimeout(() => {
          setCompacting(false);
          onClose();
        }, 400);
      })
      .catch((err: unknown) => {
        setCompacting(false);
        setCompactError(err instanceof Error ? err.message : String(err));
      });
  };

  const tokensN = stats?.tokens;
  const windowN = stats?.contextWindow;
  const messagesN = stats?.messages;
  const compaction = stats?.compaction;
  const lastCompacted = compaction?.lastCompactedAt;
  const reason = compaction?.reason;

  const percent =
    typeof tokensN === "number" &&
    typeof windowN === "number" &&
    Number.isFinite(windowN) &&
    windowN > 0
      ? Math.min(100, (tokensN / windowN) * 100)
      : undefined;

  return (
    <>
      <div className="context-panel__scrim" aria-hidden="true" onClick={onClose} />
      <div
        className="context-panel"
        role="dialog"
        aria-label="Context details"
        ref={panelRef}
      >
        <div className="context-panel__header">
          <Text variant="micro" tone="dim" mono uppercase>
            Context breakdown
          </Text>
        </div>

        <div className="context-panel__body">
          <PanelRow label="Tokens" value={fmt(tokensN)} />
          <PanelRow label="Window" value={fmt(windowN)} />
          <PanelRow
            label="Usage"
            value={percent !== undefined ? `${percent.toFixed(1)}%` : "—"}
            accent={percent !== undefined && percent > 80}
          />
          <PanelRow label="Messages" value={fmt(messagesN)} />
        </div>

        <div className="context-panel__section">
          <Text variant="micro" tone="dim" mono uppercase>
            Compaction
          </Text>
          <div className="context-panel__body">
            <PanelRow label="Last compacted" value={fmtDate(lastCompacted)} />
            <PanelRow label="Reason" value={reason ?? "—"} />
          </div>
        </div>

        {compactError ? (
          <div className="context-panel__error">
            <Text variant="micro" tone="danger" mono>
              {compactError}
            </Text>
          </div>
        ) : null}

        <div className="context-panel__footer">
          {onCompact ? (
            <Button
              variant="outline"
              size="sm"
              onClick={handleCompact}
              disabled={compacting}
              loading={compacting}
            >
              {compacting ? "Compacting…" : "Compact Now"}
            </Button>
          ) : (
            <Text variant="micro" tone="dim" mono uppercase>
              Compact unavailable
            </Text>
          )}
        </div>
      </div>
    </>
  );
}
