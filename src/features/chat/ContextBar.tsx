// ContextBar — a compact usage/context strip shown between the message list
// and the composer. Displays token count, context window, and message count
// from ContextStats (ipc.getContextStats / context_stats|usage events).
//
// Interactive: clicking the bar opens a context-summary popover panel showing
// the token breakdown, compaction history, and a "Compact Now" action. When
// context usage exceeds 80%, a subtle amber warning indicator with a one-click
// compact button appears inline (using the existing --pa-amber token, never
// the accent/green).

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Text } from "../../design";
import type { ContextStats } from "../../ipc/contract";
import { ContextPanel } from "./ContextPanel";

function fmt(n: number | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}k`;
  return String(n);
}

interface ContextBarProps {
  stats: ContextStats | null;
  /** Compact handler from useChat (wraps ipc.compact + refreshContextStats). */
  onCompact?: (prompt?: string) => Promise<void>;
}

export function ContextBar({ stats, onCompact }: ContextBarProps) {
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

  const [panelOpen, setPanelOpen] = useState(false);
  const [compacting, setCompacting] = useState(false);
  const barRef = useRef<HTMLDivElement | null>(null);

  // ---- Escape + outside-click to close the panel (matches SystemBar pattern) ----
  useEffect(() => {
    if (!panelOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      // Close if click lands outside both the panel and the bar itself.
      if (!barRef.current?.contains(event.target as Node)) setPanelOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPanelOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [panelOpen]);

  const warnActive = percent !== undefined && percent > 80;

  // One-click compact from the inline amber warning. Stop propagation so the
  // bar's onClick (which opens the panel) does not also fire.
  const handleInlineCompact = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (!onCompact || compacting) return;
    setCompacting(true);
    void onCompact().finally(() => setCompacting(false));
  };

  return (
    <div className="context-bar" ref={barRef}>
      <div
        className="context-bar-inner"
        role="button"
        tabIndex={0}
        aria-expanded={panelOpen}
        aria-label="Context usage details"
        onClick={() => setPanelOpen((open) => !open)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setPanelOpen((open) => !open);
          }
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
            className="context-bar-meter"
          >
            <div
              className={`context-bar-meter-fill${percent > 80 ? " context-bar-meter-fill--warn" : ""}`}
              style={{ "--ctx": `${percent}%` } as CSSProperties}
            />
          </div>
        ) : null}

        {warnActive ? (
          <div className="context-bar-warning" role="status" aria-label="Context near limit">
            <span className="context-bar-warning-dot" aria-hidden="true" />
            <Text variant="micro" tone="warning" mono uppercase>
              Context near limit
            </Text>
            {onCompact ? (
              <button
                type="button"
                className="context-bar-compact-button pa-focus-ring"
                onClick={handleInlineCompact}
                disabled={compacting}
                title="Compact context now"
              >
                {compacting ? "Compacting…" : "Compact"}
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="context-bar-spacer" />
        <Text variant="micro" tone="muted" mono>
          {fmt(messagesN)} messages
        </Text>
      </div>

      {panelOpen ? (
        <ContextPanel stats={stats ?? null} onCompact={onCompact} onClose={() => setPanelOpen(false)} />
      ) : null}
    </div>
  );
}
