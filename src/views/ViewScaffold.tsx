// ViewScaffold — shared layout for each routed view: a header (index, title,
// description) and a body area. Optional loading/error states render in place
// of children when `loading`/`error` is set, so views can adopt the empty /
// loading / error pattern without rolling their own layout. Wrapped children
// inherit an ErrorBoundary so a crash inside one view doesn't take down the
// whole app.

import { type ReactNode } from "react";
import { ErrorBoundary, Spinner, Button, Text } from "../design";
import "./views.css";

export interface ViewScaffoldProps {
  index: string;
  title: string;
  description: string;
  children?: ReactNode;
  /** Set true to render a loading skeleton in place of children. */
  loading?: boolean;
  /** When set, the body renders a graceful error state with a Retry button. */
  error?: string | null | undefined;
  /** Called when the user clicks "Retry"; typically re-loads the view's data. */
  onRetry?: () => void;
  /** Optional label for the inner ErrorBoundary; defaults to `index`. */
  errorLabel?: string;
}

export function ViewScaffold({
  index,
  title,
  description,
  children,
  loading,
  error,
  onRetry,
  errorLabel,
}: ViewScaffoldProps) {
  const showLoading = Boolean(loading) && !error;
  const showError = Boolean(error);
  return (
    <div className="view-scaffold">
      <header className="view-scaffold__header">
        <Text variant="micro" tone="dim" mono uppercase className="view-scaffold__index">
          {index}
        </Text>
        <h1 className="view-scaffold__title">{title}</h1>
        <Text variant="body" tone="muted">
          {description}
        </Text>
      </header>
      <div className="view-scaffold__body">
        {showError ? (
          <ViewScaffoldError
            label={errorLabel ?? index}
            detail={typeof error === "string" ? error : String(error ?? "")}
            onRetry={onRetry}
          />
        ) : showLoading ? (
          <ViewScaffoldLoading />
        ) : (
          <ErrorBoundary label={errorLabel ?? index}>{children}</ErrorBoundary>
        )}
      </div>
    </div>
  );
}

function ViewScaffoldLoading() {
  return (
    <div className="view-scaffold__loading" role="status" aria-label="Loading">
      <Spinner size={24} />
      <Text variant="label" tone="muted">
        Loading…
      </Text>
      <div className="view-scaffold__skeleton-row" aria-hidden="true">
        <span className="view-scaffold__skeleton-bar" />
        <span className="view-scaffold__skeleton-bar view-scaffold__skeleton-bar--w62" />
        <span className="view-scaffold__skeleton-bar view-scaffold__skeleton-bar--w78" />
      </div>
    </div>
  );
}

function ViewScaffoldError({
  label,
  detail,
  onRetry,
}: {
  label: string;
  detail: string;
  onRetry?: () => void;
}) {
  return (
    <div className="view-scaffold__error" role="alert">
      <div className="view-scaffold__error-icon view-scaffold__error-icon--danger" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <line x1="12" y1="8" x2="12" y2="13" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>
      <Text variant="micro" tone="danger" mono uppercase>
        {label} failed to load
      </Text>
      <Text variant="label" tone="muted">
        Something went wrong. Retry to recover, or check the daemon connection.
      </Text>
      {detail ? (
        <pre className="view-scaffold__error-detail">{detail}</pre>
      ) : null}
      {onRetry ? (
        <Button variant="accent-soft" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}
