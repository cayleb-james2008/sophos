// SessionCard — a row in the session rail. Distinctive identity: avatar block
// with status, a telemetry pragma (model · duration · cwd), a left-edge accent
// keyed to status, context usage bar, goal badge count, and RLM child count.
// Hover-revealed action buttons: Switch, Resume, Fork.

import type { SessionInfo, ContextStats, Goal, RlmChild } from "../../ipc/contract";
import { initials, durationLabel, formatTokens } from "./format";
import { PlayIcon, ForkIcon, RefreshIcon, TargetIcon, LayersIcon } from "./icons";

export function SessionCard({
  session,
  model,
  context,
  goals,
  rlmChildren,
  selected,
  onSelect,
  onSwitch,
  onResume,
  onFork,
}: {
  session: SessionInfo;
  model?: string;
  context?: ContextStats;
  goals?: Goal[];
  rlmChildren?: RlmChild[];
  selected: boolean;
  onSelect: () => void;
  onSwitch: () => void;
  onResume: () => void;
  onFork: () => void;
}) {
  const status = session.status ?? "idle";
  const cls = [
    "session",
    status === "active" ? "session--active" : "",
    status === "saved" ? "session--saved" : "",
    selected ? "session--selected" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const pragma = [
    model ?? "—",
    durationLabel(session.createdAt, session.updatedAt),
    session.cwd ? shortPath(session.cwd) : "no cwd",
  ]
    .filter(Boolean)
    .join(" · ");

  const contextPct =
    context?.tokens != null && context?.contextWindow
      ? Math.min(100, Math.round((context.tokens / context.contextWindow) * 100))
      : undefined;

  const activeGoals = goals?.filter((g) => g.status === "active").length ?? 0;
  const childCount = rlmChildren?.length ?? 0;

  return (
    <div
      className={cls}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      <span className="session__edge" />
      <span className="session__avatar">
        {initials(session.title)}
        <i className={`status status--${status}`} />
      </span>
      <span className="session__meta">
        <b>{session.title || session.id}</b>
        <small title={pragma}>{pragma}</small>
        {(contextPct != null || activeGoals > 0 || childCount > 0) && (
          <span className="session__chips">
            {contextPct != null && (
              <span className={`session__ctx ${contextPct > 80 ? "session__ctx--danger" : ""}`}>
                <i
                  className="session__ctx-dot"
                  style={{ width: `${Math.max(3, (contextPct / 100) * 22)}px` }}
                />
                {formatTokens(context?.tokens)}
                {context?.contextWindow ? `/${formatTokens(context.contextWindow)}` : ""}
              </span>
            )}
            {activeGoals > 0 && (
              <span className="session__chip" title={`${activeGoals} active goal${activeGoals > 1 ? "s" : ""}`}>
                <TargetIcon size={9} /> {activeGoals}
              </span>
            )}
            {childCount > 0 && (
              <span className="session__chip" title={`${childCount} RLM child${childCount > 1 ? "ren" : ""}`}>
                <LayersIcon size={9} /> {childCount}
              </span>
            )}
          </span>
        )}
      </span>
      <span className="session__actions" onClick={(e) => e.stopPropagation()}>
        <button className="session__act" title="Switch to session" onClick={onSwitch}>
          <PlayIcon size={13} />
        </button>
        <button className="session__act" title="Resume session" onClick={onResume}>
          <RefreshIcon size={13} />
        </button>
        <button className="session__act" title="Fork session" onClick={onFork}>
          <ForkIcon size={13} />
        </button>
      </span>
    </div>
  );
}

function shortPath(path: string): string {
  if (!path) return "—";
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length <= 2) return path;
  return ".../" + parts.slice(-2).join("/");
}
