// EmptyState — polished, reusable zero-data placeholder for the Sophos views.
// Renders an icon, an optional badge, a title, a description, an optional
// action button, and an optional footer meta line. Visual styling lives in
// views.css so the file stays clean of inline styles.

import type { ReactNode } from "react";
import { Text, Badge, Button, type BadgeTone } from "../design";
import "./views.css";

export interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description: string;
  badge?: string;
  badgeTone?: BadgeTone;
  actionLabel?: string;
  onAction?: () => void;
  meta?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  badge,
  badgeTone = "accent",
  actionLabel,
  onAction,
  meta,
}: EmptyStateProps) {
  return (
    <div className="empty-state">
      <div className="empty-state__icon" aria-hidden="true">
        {icon}
      </div>

      <div className="empty-state__prompt" aria-hidden="true">
        <span className="empty-state__prompt-glyph">$</span> sophos
      </div>

      <div className="empty-state__group">
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
