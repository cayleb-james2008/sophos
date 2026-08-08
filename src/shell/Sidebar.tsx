// Sidebar — the left nav rail of the Sophos frame. Monochrome brand mark at
// the bottom, nav items with hairline separators, a single accent bar marking
// the active view. The live telemetry lives in the SystemBar above; the rail
// stays quiet and disciplined.

import { tokens } from "../design/tokens";
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
    <aside
      style={{
        width: tokens.layout.sidebarW,
        flexShrink: 0,
        background: tokens.color.bg,
        borderRight: `1px solid ${tokens.color.border}`,
        display: "flex",
        flexDirection: "column",
        height: "100%",
      }}
    >
      {/* Eyebrow */}
      <div style={{ padding: `${tokens.space.lg} ${tokens.space.lg} ${tokens.space.sm}` }}>
        <Text variant="micro" tone="dim" mono uppercase style={{ letterSpacing: "0.14em" }}>
          Navigate
        </Text>
      </div>

      {/* Nav */}
      <nav style={{ display: "flex", flexDirection: "column", padding: `0 ${tokens.space.sm}` }}>
        {NAV_ITEMS.map((item) => {
          const isActive = item.id === active;
          const Icon = item.icon;
          return (
            <Tooltip key={item.id} content={item.hint} side="right">
              <button
                onClick={() => onNavigate(item.id)}
                aria-current={isActive ? "page" : undefined}
                className="pa-focus-ring"
                style={{
                  position: "relative",
                  display: "flex",
                  alignItems: "center",
                  gap: tokens.space.md,
                  width: "100%",
                  padding: "9px 12px",
                  marginBottom: 2,
                  borderRadius: tokens.radius.md,
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  color: isActive ? tokens.color.text : tokens.color.textMuted,
                  fontFamily: tokens.font.sans,
                  fontSize: tokens.font.size.sm,
                  fontWeight: isActive ? tokens.font.weight.semibold : tokens.font.weight.regular,
                  letterSpacing: "0.01em",
                  transition: `background ${tokens.motion.fast} ${tokens.motion.ease}, color ${tokens.motion.fast} ${tokens.motion.ease}`,
                }}
                onMouseEnter={(e) => {
                  if (!isActive) e.currentTarget.style.background = tokens.color.surface2;
                }}
                onMouseLeave={(e) => {
                  if (!isActive) e.currentTarget.style.background = "transparent";
                }}
              >
                {/* Active indicator bar */}
                {isActive ? (
                  <span
                    style={{
                      position: "absolute",
                      left: 0,
                      top: "50%",
                      transform: "translateY(-50%)",
                      width: 3,
                      height: 18,
                      borderRadius: 0,
                      background: tokens.color.accent,
                    }}
                  />
                ) : null}
                <Icon size={16} color={isActive ? tokens.color.accent : tokens.color.textDim} />
                {item.label}
                {item.id === "inbox" ? <InboxBadge /> : null}
              </button>
            </Tooltip>
          );
        })}
      </nav>

      {/* Hairline separator */}
      <div style={{ margin: `${tokens.space.md} ${tokens.space.lg}`, height: 1, background: tokens.color.border }} />

      {/* Footer — command hint + monochrome mark */}
      <div
        style={{
          marginTop: "auto",
          padding: tokens.space.lg,
          display: "flex",
          flexDirection: "column",
          gap: tokens.space.lg,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "6px 10px",
            borderRadius: tokens.radius.md,
            border: `1px solid ${tokens.color.border}`,
            background: tokens.color.surface,
          }}
        >
          <Text variant="micro" tone="dim" mono uppercase style={{ letterSpacing: "0.1em" }}>
            Command
          </Text>
          <Kbd>⌘K</Kbd>
        </div>

        {/* Monochrome brand mark */}
        <div style={{ display: "flex", alignItems: "center", gap: tokens.space.sm }}>
          <span
            style={{
              width: 22,
              height: 22,
              borderRadius: tokens.radius.sm,
              background: tokens.color.surface2,
              border: `1px solid ${tokens.color.border}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <SigmaGlyph size={14} />
          </span>
          <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
            <Text
              as="span"
              style={{ fontFamily: tokens.font.display, fontSize: 12, fontWeight: 600, letterSpacing: "0.06em", color: tokens.color.text }}
            >
              SOPHOS
            </Text>
            <Text variant="micro" tone="dim" mono style={{ fontSize: 9 }}>
              v0.1.0 · 2026-08-06
            </Text>
          </div>
        </div>
      </div>
    </aside>
  );
}

/** Unread message count badge on the Inbox nav item. Resilient: renders
 *  nothing if no provider is mounted. */
function InboxBadge() {
  const count = useUnreadBadge();
  if (!count) return null;
  return (
    <Badge tone="danger" style={{ marginLeft: "auto", minWidth: 18, height: 18, padding: "0 5px" }}>
      {count}
    </Badge>
  );
}
