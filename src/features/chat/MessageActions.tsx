// MessageActions — a compact, hover-revealed action toolbar for a message row.
// Terminal-grade: small stroke icons, currentColor, no new colors, no rounding.
// Per-role actions:
//   * all roles — Copy
//   * user      — Edit & resend
//   * assistant — Retry / regenerate
//   * system    — Copy only (status pill)
//   * tool      — Copy only
//
// The toolbar appears on hover (like the existing CopyButton) and fades in with
// a small rise. Copy falls back to a hidden-textarea execCommand when the
// clipboard API is unavailable.

import { useState } from "react";
import { Button } from "../../design";

function ActionButton({
  label,
  title,
  onClick,
  children,
}: {
  label: string;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      type="button"
      aria-label={label}
      title={title}
      onClick={onClick}
      className="message-action-btn"
    >
      {children}
    </Button>
  );
}

// Icons (12px, stroke-based, currentColor) — matching the existing CopyButton.
function CopyGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function EditGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
    </svg>
  );
}

function RetryGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="1 4 1 10 7 10" />
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
    </svg>
  );
}

export function MessageActions({
  role,
  content,
  onRetry,
  onEdit,
  canRetry,
  canEdit,
}: {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  onRetry?: () => void;
  onEdit?: () => void;
  canRetry?: boolean;
  canEdit?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content);
    } catch {
      // Fallback for restricted contexts.
      const ta = document.createElement("textarea");
      ta.value = content;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {
        /* ignore */
      }
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      className={`message-actions${visible || copied ? " is-visible" : ""}`}
    >
      <ActionButton label="Copy message" title={copied ? "Copied" : "Copy"} onClick={copy}>
        {copied ? <CheckGlyph /> : <CopyGlyph />}
      </ActionButton>
      {role === "user" && canEdit && onEdit ? (
        <ActionButton label="Edit and resend" title="Edit and resend" onClick={onEdit}>
          <EditGlyph />
        </ActionButton>
      ) : null}
      {role === "assistant" && canRetry && onRetry ? (
        <ActionButton label="Retry" title="Retry" onClick={onRetry}>
          <RetryGlyph />
        </ActionButton>
      ) : null}
    </div>
  );
}
