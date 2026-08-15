// ContextRing — an SVG ring showing how much of the model's context window is
// used (tokens / contextWindow). Terminal-green fill that turns danger-red past
// 80%, centered with the live percentage and token count. Pure presentational;
// the caller owns the ContextStats lookup.

import { formatTokens } from "./format";
import type { CSSProperties } from "react";

export function ContextRing({
  tokens: t,
  contextWindow,
  messages,
  size = 64,
}: {
  tokens?: number;
  contextWindow?: number;
  messages?: number;
  size?: number;
}) {
  const frac = t && contextWindow ? Math.min(1, t / contextWindow) : 0;
  const pct = Math.round(frac * 100);
  const r = (size - 14) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - frac);
  const danger = frac > 0.8;
  const cx = size / 2;

  return (
    <div className="ctx-ring" style={{ "--ring-size": `${size}px` } as CSSProperties} role="img" aria-label={`Context window ${pct}% used`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle className="ctx-ring__track" cx={cx} cy={cx} r={r} />
        <circle
          className={`ctx-ring__fill${danger ? " ctx-ring__fill--danger" : ""}`}
          cx={cx}
          cy={cx}
          r={r}
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${cx} ${cx})`}
        />
      </svg>
      <div className="ctx-ring__center">
        <b className={`ctx-ring__pct${danger ? " ctx-ring__pct--danger" : ""}`}>{pct}%</b>
        <span title={`${t ?? "—"} of ${contextWindow ?? "—"} tokens`}>{formatTokens(t)}</span>
        {messages != null && <em>{messages}</em>}
      </div>
    </div>
  );
}
