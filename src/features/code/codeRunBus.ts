// codeRunBus — module-level event bus for Code Mode run events (v0.7.1).
//
// Demo mode has two simulation paths: the Tauri `--demo` shell streams
// session_events through IPC (the run store subscribes via useIpcEvent), while
// the browser preview drives the transcript directly through
// simulateResponse's callbacks. This bus lets the browser-preview sim publish
// run_code / tool_call / tool_result events to the same store, so both paths
// decompose a program into the same tool-call cards and Trajectory entries.
//
// The bus is a no-op when nothing subscribes — production (real daemon)
// never publishes to it.

export type CodeRunEvent =
  | { type: "run_code"; runId: string; sessionId: string; program: string; ts: string }
  | { type: "tool_call"; runId: string; sessionId: string; name: string; input?: string; ts: string }
  | { type: "tool_result"; runId: string; sessionId: string; name: string; output?: string; ts: string }
  | { type: "run_complete"; runId: string; sessionId: string; ts: string };

type Listener = (event: CodeRunEvent) => void;

const listeners = new Set<Listener>();

/** Publish a run event to all subscribers (synchronous, ordered). */
export function publishCodeRunEvent(event: CodeRunEvent): void {
  for (const listener of listeners) listener(event);
}

/** Subscribe to run events. Returns an unsubscribe function. */
export function subscribeCodeRunEvents(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
