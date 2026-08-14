// Shared async-action error handling for the long-running / goals panels.
//
// The panel actions call the IPC bridge (runCommand / refine). When the daemon
// is unreachable the bridge rejects ("no active daemon connection"); without a
// catch the rejection becomes an unhandled promise rejection and the user gets
// no feedback. `useActionError` wraps those calls so failures surface inline,
// and `ActionErrorBanner` renders the message on the panel.

import { useState } from "react";
import { Text } from "../../design";
import "./longrunning.css";

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
    <div role="alert" className="lr-error">
      <span className="lr-error-glyph">!</span>
      <Text variant="micro" tone="danger">
        {message}
      </Text>
    </div>
  );
}
