// Sidebar — quiet navigation for the Configure/Operate shell. The live
// telemetry stays in SystemBar; this rail stays intentionally calm.

import { Text, Tooltip, Kbd, Badge } from "../design";
import { useUnreadBadge } from "../ipc/unread";
import { SigmaGlyph } from "./icons";
import { NAV_ITEMS, type View } from "./nav";

export function Sidebar({
  active,
  onNavigate,
}: {
  active: View;
  onNavigate: (view: View) => void;
}) {
  return (
    <aside className="sidebar">
      <div className="sidebar__eyebrow">
        <Text variant="micro" tone="dim" mono uppercase className="sidebar__eyebrow-text">
          Navigate
        </Text>
      </div>

      <nav className="sidebar__nav" aria-label="Primary navigation">
        {NAV_ITEMS.map((item) => {
          const isActive = item.id === active;
          const Icon = item.icon;
          return (
            <Tooltip key={item.id} content={item.hint} side="right">
              <button
                onClick={() => onNavigate(item.id)}
                aria-current={isActive ? "page" : undefined}
                className={`pa-focus-ring sidebar__item${isActive ? " sidebar__item--active" : ""}`}
              >
                {isActive ? <span className="sidebar__active-mark" aria-hidden="true" /> : null}
                <Icon size={16} color={isActive ? "var(--pa-green)" : "rgba(var(--pa-paper-rgb), 0.45)"} />
                <span>{item.label}</span>
                {item.id === "inbox" ? <InboxBadge /> : null}
              </button>
            </Tooltip>
          );
        })}
      </nav>

      <div className="sidebar__separator" />

      <div className="sidebar__footer">
        <div className="sidebar__command">
          <Text variant="micro" tone="dim" mono uppercase>
            Command
          </Text>
          <Kbd>⌘K</Kbd>
        </div>

        <div className="sidebar__brand">
          <span className="sidebar__brand-mark" aria-hidden="true">
            <SigmaGlyph size={14} />
          </span>
          <div className="sidebar__brand-copy">
            <span className="sidebar__wordmark">SOPHOS</span>
            <span className="sidebar__version">v0.4.0-beta</span>
          </div>
        </div>
      </div>
    </aside>
  );
}

function InboxBadge() {
  const count = useUnreadBadge();
  if (!count) return null;
  return (
    <span className="sidebar__badge">
      <Badge tone="danger">{count}</Badge>
    </span>
  );
}
