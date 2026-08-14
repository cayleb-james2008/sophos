// Shared empty-state scaffold for the placeholder views. Demonstrates the
// design system while the feature modules (P4/P5) land.

import type { ReactNode } from "react";
import { tokens } from "../design/tokens";
import { Text, Badge, Button, type BadgeTone } from "../design";

export function EmptyState({
  icon,
  title,
  description,
  badge,
  badgeTone = "accent",
  actionLabel,
  onAction,
  meta,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  badge?: string;
  badgeTone?: BadgeTone;
  actionLabel?: string;
  onAction?: () => void;
  meta?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        gap: tokens.space.lg,
        padding: tokens.space["3xl"],
        height: "100%",
        maxWidth: 520,
        margin: "0 auto",
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: tokens.radius.md, // resolves to 0px (sharp) — P1 token
          background: tokens.color.surface2,
          border: `1px solid ${tokens.color.borderStrong}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: tokens.color.accent,
        }}
      >
        {icon}
      </div>

      <div
        style={{
          fontFamily: tokens.font.mono,
          fontSize: tokens.font.size.sm,
          color: tokens.color.textMuted,
          letterSpacing: "0.02em",
        }}
      >
        <span style={{ color: tokens.color.accent }}>$</span>{" "}sophos
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: tokens.space.sm }}>
        {badge ? <Badge tone={badgeTone}>{badge}</Badge> : null}
        <Text variant="title">{title}</Text>
        <Text variant="body" tone="muted">
          {description}
        </Text>
      </div>

      {actionLabel ? (
        <Button variant="accent-soft" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}

      {meta ? (
        <Text variant="micro" tone="dim" mono>
          {meta}
        </Text>
      ) : null}
    </div>
  );
}
