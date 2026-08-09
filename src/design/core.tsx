// Core design primitives — the atomic building blocks of the Sophos command
// center. Built from the tokens. P4/P5 consume these; keep the props stable.

import React from "react";
import { tokens } from "./tokens";

type CSS = React.CSSProperties;

const mono = { fontFamily: tokens.font.mono };

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
  style?: CSS;
  className?: string;
}

const textVariants: Record<TextVariant, CSS> = {
  display: { fontFamily: tokens.font.display, fontSize: tokens.font.size["3xl"], fontWeight: tokens.font.weight.medium, lineHeight: tokens.font.leading.tight, letterSpacing: "-0.015em" },
  title: { fontSize: tokens.font.size["2xl"], fontWeight: tokens.font.weight.semibold, lineHeight: tokens.font.leading.tight, letterSpacing: "-0.015em" },
  subtitle: { fontSize: tokens.font.size.lg, fontWeight: tokens.font.weight.medium, lineHeight: tokens.font.leading.normal },
  body: { fontSize: tokens.font.size.md, fontWeight: tokens.font.weight.regular, lineHeight: tokens.font.leading.relaxed },
  label: { fontSize: tokens.font.size.sm, fontWeight: tokens.font.weight.medium, lineHeight: tokens.font.leading.normal },
  micro: { fontSize: tokens.font.size.xs, fontWeight: tokens.font.weight.medium, lineHeight: tokens.font.leading.normal, letterSpacing: "0.08em" },
};

const textTones: Record<TextTone, CSS> = {
  default: { color: tokens.color.text },
  muted: { color: tokens.color.textMuted },
  dim: { color: tokens.color.textDim },
  accent: { color: tokens.color.accentHover },
  success: { color: tokens.color.success },
  warning: { color: tokens.color.warning },
  danger: { color: tokens.color.danger },
  info: { color: tokens.color.info },
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
  style,
  className,
}: TextProps) {
  return (
    <Tag
      className={className}
      htmlFor={htmlFor}
      style={{
        ...textVariants[variant],
        ...textTones[tone],
        ...(weight ? { fontWeight: tokens.font.weight[weight] } : null),
        ...(isMono ? mono : null),
        ...(uppercase ? { textTransform: "uppercase" } : null),
        ...style,
      }}
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

const buttonVariants: Record<string, CSS> = {
  // Primary = solid white bg + black text (inverted), per the Sophos aesthetic.
  primary: {
    background: "#fff",
    color: "#0e0e0e",
    border: "1px solid #fff",
  },
  "accent-soft": {
    background: tokens.color.accentSoft,
    color: tokens.color.accentHover,
    border: `1px solid ${tokens.color.accentBorder}`,
  },
  ghost: {
    background: "transparent",
    color: tokens.color.textMuted,
    border: "1px solid transparent",
  },
  outline: {
    background: "transparent",
    color: tokens.color.text,
    border: `1px solid ${tokens.color.border}`,
  },
  danger: {
    background: tokens.color.danger,
    color: "#fff",
    border: `1px solid ${tokens.color.danger}`,
  },
};

const buttonSizes: Record<string, CSS> = {
  sm: { padding: "3px 10px", fontSize: tokens.font.size.sm, gap: "6px" },
  md: { padding: "6px 14px", fontSize: tokens.font.size.sm, gap: "8px" },
  lg: { padding: "9px 18px", fontSize: tokens.font.size.md, gap: "10px" },
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  fullWidth = false,
  icon,
  children,
  style,
  disabled,
  className,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <button
      className={`pa-focus-ring ${className ?? ""}`}
      disabled={isDisabled}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: tokens.font.sans,
        fontWeight: tokens.font.weight.medium,
        borderRadius: tokens.radius.md,
        letterSpacing: "0.01em",
        cursor: isDisabled ? "not-allowed" : "pointer",
        opacity: isDisabled ? 0.5 : 1,
        transition: `all ${tokens.motion.fast} ${tokens.motion.ease}`,
        ...buttonVariants[variant],
        ...buttonSizes[size],
        ...(fullWidth ? { width: "100%" } : null),
        ...style,
      }}
      onMouseEnter={(e) => {
        if (isDisabled) return;
        const el = e.currentTarget;
        if (variant === "primary") el.style.background = "#f4f4f4";
        if (variant === "accent-soft") el.style.background = tokens.color.accentBorder;
        if (variant === "outline") el.style.borderColor = tokens.color.accentBorder;
        if (variant === "ghost") el.style.color = tokens.color.text;
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget;
        if (variant === "primary") el.style.background = "#fff";
        if (variant === "accent-soft") el.style.background = tokens.color.accentSoft;
        if (variant === "outline") el.style.borderColor = tokens.color.border;
        if (variant === "ghost") el.style.color = tokens.color.textMuted;
      }}
      {...rest}
    >
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

export function Input({ label, hint, error, prefix, suffix, style, className, id, ...rest }: InputProps) {
  const inputId = id ?? (label ? `pa-input-${label.replace(/\s+/g, "-").toLowerCase()}` : undefined);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: tokens.space.xs, width: "100%" }}>
      {label ? (
        <Text as="label" htmlFor={inputId} variant="micro" tone="muted" uppercase>
          {label}
        </Text>
      ) : null}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: tokens.space.sm,
          background: tokens.color.bgElevated,
          border: `1px solid ${error ? tokens.color.danger : tokens.color.border}`,
          borderRadius: tokens.radius.md,
          padding: "0 12px",
          transition: `border-color ${tokens.motion.fast} ${tokens.motion.ease}, box-shadow ${tokens.motion.fast} ${tokens.motion.ease}`,
        }}
      >
        {prefix}
        <input
          id={inputId}
          className={`pa-focus-ring ${className ?? ""}`}
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            outline: "none",
            color: tokens.color.text,
            fontFamily: tokens.font.sans,
            fontSize: tokens.font.size.md,
            padding: "8px 0",
            minWidth: 0,
            ...style,
          }}
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
}

// ---------------------------------------------------------------------------
// TextArea
// ---------------------------------------------------------------------------

export interface TextAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export function TextArea({ label, error, style, className, id, ...rest }: TextAreaProps) {
  const inputId = id ?? (label ? `pa-ta-${label.replace(/\s+/g, "-").toLowerCase()}` : undefined);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: tokens.space.xs, width: "100%" }}>
      {label ? (
        <Text as="label" htmlFor={inputId} variant="micro" tone="muted" uppercase>
          {label}
        </Text>
      ) : null}
      <textarea
        id={inputId}
        className={`pa-focus-ring ${className ?? ""}`}
        style={{
          background: tokens.color.bgElevated,
          border: `1px solid ${error ? tokens.color.danger : tokens.color.border}`,
          borderRadius: tokens.radius.md,
          color: tokens.color.text,
          fontFamily: tokens.font.sans,
          fontSize: tokens.font.size.md,
          lineHeight: tokens.font.leading.normal,
          padding: "10px 12px",
          resize: "vertical",
          minHeight: 72,
          outline: "none",
          transition: `border-color ${tokens.motion.fast} ${tokens.motion.ease}`,
          ...style,
        }}
        {...rest}
      />
      {error ? (
        <Text variant="micro" tone="danger">
          {error}
        </Text>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Select
// ---------------------------------------------------------------------------

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
}

export function Select({ label, options, placeholder, style, className, id, ...rest }: SelectProps) {
  const selectId = id ?? (label ? `pa-select-${label.replace(/\s+/g, "-").toLowerCase()}` : undefined);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: tokens.space.xs, width: "100%" }}>
      {label ? (
        <Text as="label" htmlFor={selectId} variant="micro" tone="muted" uppercase>
          {label}
        </Text>
      ) : null}
      <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
        <select
          id={selectId}
          className={`pa-focus-ring ${className ?? ""}`}
          style={{
            appearance: "none",
            width: "100%",
            background: tokens.color.bgElevated,
            border: `1px solid ${tokens.color.border}`,
            borderRadius: tokens.radius.md,
            color: tokens.color.text,
            fontFamily: tokens.font.sans,
            fontSize: tokens.font.size.sm,
            padding: "8px 30px 8px 12px",
            cursor: "pointer",
            outline: "none",
            transition: `border-color ${tokens.motion.fast} ${tokens.motion.ease}`,
            ...style,
          }}
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
        <span
          style={{
            position: "absolute",
            right: 10,
            pointerEvents: "none",
            color: tokens.color.textDim,
            fontSize: 9,
          }}
        >
          ▾
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Kbd
// ---------------------------------------------------------------------------

export function Kbd({ children, style }: { children: React.ReactNode; style?: CSS }) {
  return (
    <kbd
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 20,
        height: 20,
        padding: "0 6px",
        background: tokens.color.bgRaised,
        border: `1px solid ${tokens.color.border}`,
        borderBottomWidth: 2,
        borderRadius: tokens.radius.sm,
        color: tokens.color.textMuted,
        fontFamily: tokens.font.mono,
        fontSize: tokens.font.size.xs,
        lineHeight: 1,
        ...style,
      }}
    >
      {children}
    </kbd>
  );
}

// ---------------------------------------------------------------------------
// Spinner
// ---------------------------------------------------------------------------

export function Spinner({ size = 16, style }: { size?: number; style?: CSS }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      style={{
        display: "inline-block",
        width: size,
        height: size,
        border: `2px solid ${tokens.color.border}`,
        borderTopColor: tokens.color.accent,
        borderRadius: "50%",
        animation: "pa-spin 0.8s linear infinite",
        ...style,
      }}
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
  style,
}: {
  children: React.ReactNode;
  tone?: BadgeTone;
  dot?: boolean;
  style?: CSS;
}) {
  const tones: Record<BadgeTone, CSS> = {
    neutral: { background: tokens.color.bgOverlay, color: tokens.color.textMuted },
    accent: { background: tokens.color.accentSoft, color: tokens.color.accentHover },
    success: { background: "rgba(133,237,117,0.12)", color: tokens.color.success },
    warning: { background: "rgba(243,188,86,0.12)", color: tokens.color.warning },
    danger: { background: "rgba(239,68,68,0.12)", color: tokens.color.danger },
    info: { background: "rgba(139,124,246,0.12)", color: tokens.color.info },
  };
  const dotColors: Record<BadgeTone, string> = {
    neutral: tokens.color.textDim,
    accent: tokens.color.accentHover,
    success: tokens.color.success,
    warning: tokens.color.warning,
    danger: tokens.color.danger,
    info: tokens.color.info,
  };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: tokens.space.xs,
        padding: "2px 8px",
        borderRadius: tokens.radius.sm,
        border: "1px solid transparent",
        fontSize: tokens.font.size.xs,
        fontWeight: tokens.font.weight.medium,
        whiteSpace: "nowrap",
        ...tones[tone],
        ...style,
      }}
    >
      {dot ? (
        <span
          style={{
            width: 5,
            height: 5,
            borderRadius: "50%",
            background: dotColors[tone],
          }}
        />
      ) : null}
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// StatusDot — live connection indicator
// ---------------------------------------------------------------------------

export type StatusDotState = "connecting" | "connected" | "disconnected" | "reconnecting" | "idle";

const statusColors: Record<StatusDotState, string> = {
  connecting: tokens.color.warning,
  connected: tokens.color.success,
  disconnected: tokens.color.danger,
  reconnecting: tokens.color.info,
  idle: tokens.color.textDim,
};

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
  style,
}: {
  state?: StatusDotState;
  label?: string;
  pulse?: boolean;
  size?: number;
  style?: CSS;
}) {
  const color = statusColors[state];
  const isPulsing = pulse && (state === "connecting" || state === "reconnecting");
  return (
    <span
      role="status"
      aria-label={label ?? statusLabels[state]}
      title={label ?? statusLabels[state]}
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        ...style,
      }}
    >
      {isPulsing ? (
        <span
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            background: color,
            animation: "pa-beat 1.4s cubic-bezier(0,0,0.2,1) infinite",
          }}
        />
      ) : null}
      <span
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          background: color,
          boxShadow: `0 0 0 3px ${color}22`,
          animation: isPulsing ? "pa-pulse 1.2s ease-in-out infinite" : undefined,
        }}
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
  style?: CSS;
  disabled?: boolean;
}

export function IconButton({
  children,
  onClick,
  title,
  tone = "default",
  size = "md",
  style,
  disabled = false,
}: IconButtonProps) {
  const tones: Record<string, CSS> = {
    default: { color: tokens.color.textMuted },
    accent: { color: tokens.color.accentHover },
    danger: { color: tokens.color.danger },
  };
  const sizes: Record<string, CSS> = {
    sm: { padding: "5px" },
    md: { padding: "7px" },
  };
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className="pa-focus-ring"
      style={{
        background: "transparent",
        border: "none",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
        borderRadius: tokens.radius.sm,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        transition: `all ${tokens.motion.fast} ${tokens.motion.ease}`,
        ...tones[tone],
        ...sizes[size],
        ...style,
      }}
      onMouseEnter={(e) => {
        if (disabled) return;
        e.currentTarget.style.background = tokens.color.bgOverlay;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      {children}
    </button>
  );
}
