// Core design primitives — the atomic building blocks of the Sophos command
// center. Built from the tokens. P4/P5 consume these; keep the props stable.
//
// Style composition is class-driven via primitives.css — variant names map to
// BEM-style classes (`pa-button`, `pa-button--primary`, etc.) — so the
// styled-dom pipeline never needs to parse JS objects at runtime.

import React from "react";
import { tokens } from "./tokens";
import "./primitives.css";

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

export type TextVariant = "display" | "title" | "subtitle" | "body" | "label" | "micro";
export type TextTone =
  | "default"
  | "muted"
  | "dim"
  | "accent"
  | "success"
  | "warning"
  | "danger"
  | "info";

export interface TextProps {
  as?: React.ElementType;
  variant?: TextVariant;
  tone?: TextTone;
  weight?: "regular" | "medium" | "semibold" | "bold";
  mono?: boolean;
  uppercase?: boolean;
  htmlFor?: string;
  children?: React.ReactNode;
  className?: string;
  /** Optional escape hatch for layout-specific tweaks (letter-spacing, etc.)
   *  that aren't worth a dedicated class. Reserved for things like eyebrow
   *  microcopy where one design token is moved by a few units. */
  style?: React.CSSProperties;
}

const variantClass: Record<TextVariant, string> = {
  display: "pa-text--display",
  title: "pa-text--title",
  subtitle: "pa-text--subtitle",
  body: "pa-text--body",
  label: "pa-text--label",
  micro: "pa-text--micro",
};

const toneClass: Record<TextTone, string> = {
  default: "pa-text--default",
  muted: "pa-text--muted",
  dim: "pa-text--dim",
  accent: "pa-text--accent",
  success: "pa-text--success",
  warning: "pa-text--warning",
  danger: "pa-text--danger",
  info: "pa-text--info",
};

export function Text({
  as: Tag = "span",
  variant = "body",
  tone = "default",
  weight,
  mono: isMono = false,
  uppercase = false,
  htmlFor,
  children,
  className,
  style,
}: TextProps) {
  // Text renders static typography + tone via classes. Weight / mono /
  // uppercase are still applied inline because they're only a handful of
  // trivial CSS declarations on the host element, NOT cross-component styling.
  const composed: React.CSSProperties = { ...(style ?? {}) };
  if (weight) composed.fontWeight = tokens.font.weight[weight];
  if (isMono) composed.fontFamily = tokens.font.mono;
  if (uppercase) composed.textTransform = "uppercase";

  return (
    <Tag
      className={[variantClass[variant], toneClass[tone], className].filter(Boolean).join(" ")}
      htmlFor={htmlFor}
      style={Object.keys(composed).length ? composed : undefined}
    >
      {children}
    </Tag>
  );
}

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "ghost" | "outline" | "danger" | "accent-soft";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  fullWidth?: boolean;
  icon?: React.ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  fullWidth = false,
  icon,
  children,
  disabled,
  className,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const cls = [
    "pa-button",
    `pa-button--${variant}`,
    `pa-button--${size}`,
    fullWidth ? "pa-button--full" : null,
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button {...rest} disabled={isDisabled} className={cls + " pa-focus-ring"}>
      {loading ? <Spinner size={size === "sm" ? 12 : 14} /> : icon}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "prefix"> {
  label?: string;
  hint?: string;
  error?: string;
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, prefix, suffix, style, className, id, ...rest },
  ref,
) {
  const inputId = id ?? (label ? `pa-input-${label.replace(/\s+/g, "-").toLowerCase()}` : undefined);
  return (
    <div className="pa-input-field">
      {label ? (
        <Text as="label" htmlFor={inputId} variant="micro" tone="muted" uppercase>
          {label}
        </Text>
      ) : null}
      <div className={["pa-input-shell", error ? "pa-input-shell--error" : null].filter(Boolean).join(" ")}>
        {prefix}
        <input
          id={inputId}
          ref={ref}
          className={["pa-input-input pa-focus-ring", className].filter(Boolean).join(" ")}
          {...rest}
        />
        {suffix}
      </div>
      {error ? (
        <Text variant="micro" tone="danger">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="micro" tone="dim">
          {hint}
        </Text>
      ) : null}
    </div>
  );
});

// ---------------------------------------------------------------------------
// TextArea
// ---------------------------------------------------------------------------

export interface TextAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export const TextArea = React.forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { label, error, style, className, id, ...rest },
  ref,
) {
  const inputId = id ?? (label ? `pa-ta-${label.replace(/\s+/g, "-").toLowerCase()}` : undefined);
  return (
    <div className="pa-ta-field">
      {label ? (
        <Text as="label" htmlFor={inputId} variant="micro" tone="muted" uppercase>
          {label}
        </Text>
      ) : null}
      <textarea
        id={inputId}
        ref={ref}
        className={["pa-ta-textarea pa-focus-ring", error ? "pa-ta-textarea--error" : null, className].filter(Boolean).join(" ")}
        {...rest}
      />
      {error ? (
        <Text variant="micro" tone="danger">
          {error}
        </Text>
      ) : null}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Select
// ---------------------------------------------------------------------------

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, options, placeholder, style, className, id, ...rest },
  ref,
) {
  const selectId = id ?? (label ? `pa-select-${label.replace(/\s+/g, "-").toLowerCase()}` : undefined);
  return (
    <div className="pa-select-field">
      {label ? (
        <Text as="label" htmlFor={selectId} variant="micro" tone="muted" uppercase>
          {label}
        </Text>
      ) : null}
      <div className="pa-select-shell">
        <select
          id={selectId}
          ref={ref}
          className={["pa-select-native pa-focus-ring", className].filter(Boolean).join(" ")}
          {...rest}
        >
          {placeholder ? (
            <option value="" disabled>
              {placeholder}
            </option>
          ) : null}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <span className="pa-select-caret">▾</span>
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Kbd
// ---------------------------------------------------------------------------

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd className={["pa-kbd", className].filter(Boolean).join(" ")}>
      {children}
    </kbd>
  );
}

// ---------------------------------------------------------------------------
// Spinner
// ---------------------------------------------------------------------------

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={["pa-spinner", className].filter(Boolean).join(" ")}
      style={{ "--pa-spinner-size": `${size}px` } as React.CSSProperties}
    />
  );
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

export type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

export function Badge({
  children,
  tone = "neutral",
  dot = false,
  dotTone,
  className,
}: {
  children: React.ReactNode;
  tone?: BadgeTone;
  dot?: boolean;
  /**
   * Colour the dot from a different tone than the badge itself, so a badge can
   * stay visually neutral while its dot still carries the state signal. Used
   * where an adjacent element already encodes the same state and a fully-toned
   * badge would say it twice.
   */
  dotTone?: BadgeTone;
  className?: string;
}) {
  const dotClass = `pa-badge__dot--${dotTone ?? tone}`;
  return (
    <span className={["pa-badge", `pa-badge--${tone}`, className].filter(Boolean).join(" ")}>
      {dot ? <span className={["pa-badge__dot", dotClass].filter(Boolean).join(" ")} /> : null}
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// StatusDot — live connection indicator
// ---------------------------------------------------------------------------

export type StatusDotState = "connecting" | "connected" | "disconnected" | "reconnecting" | "idle";

const statusLabels: Record<StatusDotState, string> = {
  connecting: "Connecting",
  connected: "Connected",
  disconnected: "Disconnected",
  reconnecting: "Reconnecting",
  idle: "Idle",
};

export function StatusDot({
  state = "idle",
  label,
  pulse = true,
  size = 8,
  className,
}: {
  state?: StatusDotState;
  label?: string;
  pulse?: boolean;
  size?: number;
  className?: string;
}) {
  const isPulsing = pulse && (state === "connecting" || state === "reconnecting");
  const a11yLabel = label ?? statusLabels[state];
  const glow = state !== "idle";
  return (
    <span
      role="status"
      aria-label={a11yLabel}
      title={a11yLabel}
      className={["pa-status-dot", `pa-status-dot--${state}`, className].filter(Boolean).join(" ")}
      style={{ "--pa-status-dot-size": `${size}px` } as React.CSSProperties}
    >
      {isPulsing ? <span className="pa-status-dot__pulse" /> : null}
      <span
        className={["pa-status-dot__core", glow ? "pa-status-dot__core--glow" : ""].filter(Boolean).join(" ")}
      />
    </span>
  );
}

// ---------------------------------------------------------------------------
// IconButton
// ---------------------------------------------------------------------------

export interface IconButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  title?: string;
  tone?: "default" | "accent" | "danger";
  size?: "sm" | "md";
  className?: string;
  disabled?: boolean;
}

export function IconButton({
  children,
  onClick,
  title,
  tone = "default",
  size = "md",
  className,
  disabled = false,
}: IconButtonProps) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={["pa-icon-button", `pa-icon-button--${tone}`, `pa-icon-button--${size}`, "pa-focus-ring", className]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Skeleton — a quiet loading placeholder with a pulse animation.
// ---------------------------------------------------------------------------

export function Skeleton({
  width = "100%",
  height = 16,
  radius = tokens.radius.sm,
  className,
}: {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={["pa-skeleton", className].filter(Boolean).join(" ")}
      style={{
        "--pa-skeleton-w": typeof width === "number" ? `${width}px` : width,
        "--pa-skeleton-h": typeof height === "number" ? `${height}px` : height,
        "--pa-skeleton-r": typeof radius === "number" ? `${radius}px` : radius,
      } as React.CSSProperties}
    />
  );
}
