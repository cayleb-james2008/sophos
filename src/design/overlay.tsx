// Surface & overlay components — Card, Modal, Tooltip, ScrollArea, Tabs.
// Built from the tokens. P4/P5 consume these; keep the props stable.

import React, { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { tokens } from "./tokens";
import { Text, Button } from "./core";

type CSS = React.CSSProperties;

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export interface CardProps {
  variant?: "default" | "raised" | "interactive" | "accent";
  padding?: "none" | "sm" | "md" | "lg";
  children?: React.ReactNode;
  style?: CSS;
  /** Extra layout/theme class(es) applied alongside the base card styles. */
  className?: string;
  onClick?: () => void;
}

const cardVariants: Record<string, CSS> = {
  default: { background: tokens.color.bgElevated, border: `1px solid ${tokens.color.border}` },
  raised: { background: tokens.color.bgRaised, border: `1px solid ${tokens.color.borderStrong}` },
  interactive: {
    background: tokens.color.bgElevated,
    border: `1px solid ${tokens.color.border}`,
    cursor: "pointer",
  },
  accent: {
    background: `linear-gradient(180deg, ${tokens.color.bgRaised}, ${tokens.color.bgElevated})`,
    border: `1px solid ${tokens.color.accentBorder}`,
  },
};

const cardPaddings: Record<string, CSS> = {
  none: { padding: 0 },
  sm: { padding: tokens.space.md },
  md: { padding: tokens.space.lg },
  lg: { padding: tokens.space.xl },
};

export function Card({ variant = "default", padding = "md", children, style, className, onClick }: CardProps) {
  return (
    <div
      className={className}
      onClick={onClick}
      style={{
        borderRadius: tokens.radius.lg,
        boxShadow: tokens.shadow.sm,
        transition: `all ${tokens.motion.base} ${tokens.motion.easeOut}`,
        ...cardVariants[variant],
        ...cardPaddings[padding],
        ...(variant === "interactive"
          ? {
              ":hover": {
                borderColor: tokens.color.accentBorder,
                transform: "translateY(-1px)",
                boxShadow: tokens.shadow.md,
              },
            }
          : null),
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ScrollArea
// ---------------------------------------------------------------------------

export function ScrollArea({
  children,
  style,
  className,
}: {
  children: React.ReactNode;
  style?: CSS;
  className?: string;
}) {
  return (
    <div
      className={className}
      style={{
        overflowY: "auto",
        overflowX: "hidden",
        height: "100%",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

export interface TabItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  items: TabItem[];
  activeId: string;
  onChange: (id: string) => void;
  variant?: "underline" | "pill";
  style?: CSS;
}

export function Tabs({ items, activeId, onChange, variant = "underline", style }: TabsProps) {
  return (
    <div
      role="tablist"
      style={{
        display: "flex",
        alignItems: "center",
        gap: variant === "pill" ? tokens.space.xs : tokens.space.lg,
        ...(variant === "underline"
          ? { borderBottom: `1px solid ${tokens.color.border}` }
          : null),
        ...style,
      }}
    >
      {items.map((item) => {
        const active = item.id === activeId;
        return (
          <button
            key={item.id}
            role="tab"
            aria-selected={active}
            disabled={item.disabled}
            onClick={() => onChange(item.id)}
            className="pa-focus-ring"
            style={{
              position: "relative",
              display: "inline-flex",
              alignItems: "center",
              gap: tokens.space.sm,
              background: variant === "pill" && active ? tokens.color.accentSoft : "transparent",
              border: "none",
              cursor: item.disabled ? "not-allowed" : "pointer",
              opacity: item.disabled ? 0.4 : 1,
              color: active ? tokens.color.text : tokens.color.textMuted,
              fontFamily: tokens.font.sans,
              fontSize: tokens.font.size.sm,
              fontWeight: tokens.font.weight.medium,
              padding: variant === "pill" ? "6px 14px" : "8px 2px",
              borderRadius: tokens.radius.sm,
              transition: `color ${tokens.motion.fast} ${tokens.motion.ease}, background ${tokens.motion.fast} ${tokens.motion.ease}`,
            }}
          >
            {item.icon}
            {item.label}
            {variant === "underline" && active ? (
              <span
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: -1,
                  height: 2,
                  borderRadius: 0, // sharp — P4 critic fix
                  background: tokens.color.accent,
                }}
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

export interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  delay?: number;
}

export function Tooltip({ content, children, side = "top", delay = 300 }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const id = useId();

  const show = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setVisible(true), delay);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    setVisible(false);
  };

  const sideStyle: Record<string, CSS> = {
    top: { bottom: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)" },
    bottom: { top: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)" },
    left: { right: "calc(100% + 8px)", top: "50%", transform: "translateY(-50%)" },
    right: { left: "calc(100% + 8px)", top: "50%", transform: "translateY(-50%)" },
  };

  return (
    <span
      style={{ position: "relative", display: "inline-flex" }}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {visible ? (
        <span
          role="tooltip"
          id={id}
          style={{
            position: "absolute",
            zIndex: 100,
            whiteSpace: "nowrap",
            background: tokens.color.bgOverlay,
            border: `1px solid ${tokens.color.borderStrong}`,
            borderRadius: tokens.radius.sm,
            padding: "5px 9px",
            color: tokens.color.text,
            fontFamily: tokens.font.sans,
            fontSize: tokens.font.size.xs,
            fontWeight: tokens.font.weight.medium,
            boxShadow: tokens.shadow.md,
            animation: "pa-scale-in 120ms cubic-bezier(0.16,1,0.3,1)",
            ...sideStyle[side],
          }}
        >
          {content}
        </span>
      ) : null}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
}

export function Modal({ open, onClose, title, children, footer, width = 480 }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: tokens.space.xl,
      }}
    >
      <div
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(5,5,8,0.7)",
          backdropFilter: "blur(4px)",
          animation: "pa-fade-in 160ms ease",
        }}
      />
      <div
        style={{
          position: "relative",
          width,
          maxWidth: "100%",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          background: tokens.color.bgRaised,
          border: `1px solid ${tokens.color.borderStrong}`,
          borderRadius: tokens.radius.lg,
          boxShadow: tokens.shadow.lg,
          animation: "pa-scale-in 200ms cubic-bezier(0.16,1,0.3,1)",
        }}
      >
        {title ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: `${tokens.space.lg} ${tokens.space.xl}`,
              borderBottom: `1px solid ${tokens.color.border}`,
            }}
          >
            <Text variant="subtitle">{title}</Text>
            <button
              onClick={onClose}
              aria-label="Close"
              className="pa-focus-ring"
              style={{
                background: "transparent",
                border: "none",
                color: tokens.color.textDim,
                cursor: "pointer",
                fontSize: 16,
                lineHeight: 1,
                padding: 4,
                borderRadius: tokens.radius.sm,
              }}
            >
              ✕
            </button>
          </div>
        ) : null}
        <div style={{ padding: tokens.space.xl, overflowY: "auto" }}>{children}</div>
        {footer ? (
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: tokens.space.sm,
              padding: `${tokens.space.md} ${tokens.space.xl}`,
              borderTop: `1px solid ${tokens.color.border}`,
            }}
          >
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// ErrorBoundary — catches render errors and shows a design-system fallback.
// ---------------------------------------------------------------------------

interface ErrorBoundaryProps {
  children?: React.ReactNode;
  /** Optional label rendered in the fallback header. */
  label?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("ErrorBoundary caught a render error:", error);
  }

  private handleReload = () => {
    this.setState({ error: null });
    window.location.reload();
  };

  render() {
    if (this.state.error) {
      const { label } = this.props;
      return (
        <div
          role="alert"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: tokens.space.md,
            minHeight: "100%",
            padding: tokens.space.xl,
            background: tokens.color.bg,
            color: tokens.color.text,
            fontFamily: tokens.font.sans,
            textAlign: "center",
          }}
        >
          <div
            style={{
              maxWidth: 480,
              width: "100%",
              display: "flex",
              flexDirection: "column",
              gap: tokens.space.md,
              padding: tokens.space.xl,
              background: tokens.color.bgElevated,
              border: `1px solid ${tokens.color.border}`,
              borderRadius: tokens.radius.lg,
            }}
          >
            <Text variant="micro" tone="accent" mono uppercase style={{ letterSpacing: "0.12em" }}>
              {label ?? "Something went wrong"}
            </Text>
            <Text variant="body" tone="muted">
              A render error occurred in this view. Reload to recover.
            </Text>
            <Text
              variant="micro"
              tone="danger"
              mono
              style={{
                padding: tokens.space.sm,
                background: tokens.color.dangerSoft,
                border: `1px solid ${tokens.color.border}`,
                borderRadius: tokens.radius.sm,
                overflowX: "auto",
                wordBreak: "break-word",
                textAlign: "left",
              }}
            >
              {this.state.error.message || String(this.state.error)}
            </Text>
            <Button variant="accent-soft" size="md" onClick={this.handleReload} style={{ alignSelf: "center" }}>
              Reload
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
