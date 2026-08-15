// Surface & overlay components — Card, Modal, Tooltip, ScrollArea, Tabs,
// ErrorBoundary. Built from the tokens. P4/P5 consume these; keep the props
// stable.
//
// Styling is class-driven (overlay.css). Modal width and tooltip placement are
// passed through CSS custom properties or class switches so the component
// functions remain declarative.

import React, { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { tokens } from "./tokens";
import { Text, Button } from "./core";
import "./overlay.css";

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export interface CardProps {
  variant?: "default" | "raised" | "interactive" | "accent";
  padding?: "none" | "sm" | "md" | "lg";
  children?: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
  onClick?: () => void;
}

export function Card({
  variant = "default",
  padding = "md",
  children,
  style,
  className,
  onClick,
}: CardProps) {
  return (
    <div
      onClick={onClick}
      className={[
        "pa-card",
        `pa-card--${variant}`,
        `pa-card--p-${padding}`,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={style}
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
  style?: React.CSSProperties;
  className?: string;
}) {
  return (
    <div
      className={["pa-scroll-area", className].filter(Boolean).join(" ")}
      style={style}
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
  style?: React.CSSProperties;
  className?: string;
}

export function Tabs({ items, activeId, onChange, variant = "underline", style, className }: TabsProps) {
  return (
    <div
      role="tablist"
      className={["pa-tabs", `pa-tabs--${variant}`, className].filter(Boolean).join(" ")}
      style={style}
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
            className={[
              "pa-tab",
              `pa-tab--${variant}`,
              active ? "pa-tab--active" : null,
              "pa-focus-ring",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {item.icon}
            {item.label}
            {variant === "underline" && active ? <span className="pa-tab__underline" aria-hidden="true" /> : null}
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

  return (
    <span
      className="pa-tooltip-host"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {visible ? (
        <span role="tooltip" id={id} className={`pa-tooltip pa-tooltip--${side}`}>
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
    <div className="pa-modal" role="dialog" aria-modal="true">
      <div className="pa-modal__backdrop" onClick={onClose} aria-hidden="true" />
      <div
        className="pa-modal__panel"
        style={{ "--pa-modal-width": `${width}px` } as React.CSSProperties}
      >
        {title ? (
          <div className="pa-modal__head">
            <Text variant="subtitle">{title}</Text>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="pa-modal__close pa-focus-ring"
            >
              ✕
            </button>
          </div>
        ) : null}
        <div className="pa-modal__body">{children}</div>
        {footer ? <div className="pa-modal__foot">{footer}</div> : null}
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
        <div role="alert" className="pa-error-boundary">
          <div className="pa-error-boundary__card">
            <Text variant="micro" tone="accent" mono uppercase className="pa-error-boundary__label">
              {label ?? "Something went wrong"}
            </Text>
            <Text variant="body" tone="muted">
              A render error occurred in this view. Reload to recover.
            </Text>
            <Text
              as="pre"
              variant="micro"
              tone="danger"
              mono
              className="pa-error-boundary__trace"
            >
              {this.state.error.message || String(this.state.error)}
            </Text>
            <Button variant="accent-soft" size="md" onClick={this.handleReload} className="pa-error-boundary__reload">
              Reload
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// `tokens` is imported above for any future use; the explicit re-export keeps
// callers that previously relied on it still working.
void tokens;
