// Shared node-graph theming — maps the live status vocabulary onto the Sophos
// token colors. Single source for node / edge / dot color so the four graph
// views stay visually consistent (a stark near-black terminal, one green accent).

import { tokens } from "../../design/tokens";

export type GraphStatus =
  | "ok"
  | "warn"
  | "err"
  | "idle"
  | "running"
  | "connected"
  | "connecting"
  | "reconnecting"
  | "disconnected"
  | "active"
  | "saved"
  | "done"
  | "error"
  | "paused";

/** Normalize a raw status string onto a stable color. Unknown -> muted/dim. */
export function statusColor(status?: string): string {
  switch (status) {
    case "running":
    case "connected":
    case "active":
    case "live":
    case "ok":
    case "success":
    case "daemon_alive":
      return tokens.color.ok;
    case "warn":
    case "connecting":
    case "reconnecting":
    case "paused":
      return tokens.color.warn;
    case "err":
    case "error":
    case "disconnected":
    case "failed":
    case "offline":
      return tokens.color.err;
    case "saved":
    case "done":
    case "idle":
    case "background":
    default:
      return tokens.color.textDim;
  }
}

/** A soft, transparent wash of the status color — used for node glows / edges. */
export function statusWash(status?: string): string {
  const hex = statusColor(status);
  return `${hex}22`;
}

export const ACCENT = tokens.color.accent;
export const ACCENT_HOVER = tokens.color.accentHover;
export const LINE = tokens.color.line;
export const BORDER_STRONG = tokens.color.borderStrong;
export const MUTED = tokens.color.textMuted;
export const DIM = tokens.color.textDim;
export const TEXT = tokens.color.text;
export const SURFACE = tokens.color.surface;
export const SURFACE2 = tokens.color.surface2;
