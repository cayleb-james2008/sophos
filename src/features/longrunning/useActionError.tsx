// Shared async-action error handling for the long-running / goals panels.
//
// The panel actions call the IPC bridge (runCommand / refine). When the daemon
// is unreachable the bridge rejects ("no active daemon connection"); without a
// catch the rejection becomes an unhandled promise rejection and the user gets
// no feedback. `useActionError` wraps those calls so failures surface inline,
// and `ActionErrorBanner` renders the message on the panel.

import { useState } from "react";
import { tokens } from "../../design/tokens";
import { Text } from "../../design";

export function useActionError() {
  const [error, setError] = useState<string | null>(null);
  const clearError = () => setError(null);

  /** Run an action; on rejection, capture a user-facing message. */
  const run = async (fn: () => Promise<void>, fallback = "Action failed") => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      const msg = e instanceof Error && e.message ? e.message : String(e);
      setError(msg && !msg.includes("Error") ? msg : fallback);
    }
  };

  return { error, run, clearError };
}

export function ActionErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      style={{
        display: "flex",
        alignItems: "center",
        gap: tokens.space.sm,
        padding: `${tokens.space.sm} ${tokens.space.md}`,
        borderRadius: tokens.radius.md,
        background: "rgba(208,90,90,0.10)",
        border: `1px solid ${tokens.color.danger}55`,
        color: tokens.color.danger,
      }}
    >
      <span style={{ fontSize: 12, flexShrink: 0, lineHeight: 1 }}>!</span>
      <Text variant="micro" tone="danger">
        {message}
      </Text>
    </div>
  );
}
