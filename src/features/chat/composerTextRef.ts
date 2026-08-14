// composerTextRef.ts — a tiny shared store that lets the ⌘K palette read and
// write the composer's current text without prop-threading through App.tsx.
// ComposerInput publishes every keystroke here; the palette reads it when
// "Save current prompt as template…" runs and writes it back when a template
// is inserted. This keeps a single source of truth for the draft text across
// the chat view and the command palette.

import { useSyncExternalStore } from "react";

// ---- Composer text ----
let text = "";
const listeners = new Set<(next: string) => void>();

/** Read the composer's current text (used by the palette's save command). */
export function getComposerText(): string {
  return text;
}

/**
 * Set the composer text and notify subscribers. ComposerInput calls this on
 * every onChange; the palette calls it to insert a template body back into the
 * composer. Subscribers receive the new value.
 */
export function setComposerText(next: string): void {
  if (next === text) return;
  text = next;
  listeners.forEach((l) => l(next));
}

/** Subscribe to composer-text changes. Returns an unsubscribe function. */
export function subscribeComposerText(cb: (next: string) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
function getSnapshot(): string {
  return text;
}

/** React hook — re-renders the caller whenever the composer text changes. */
export function useComposerText(): string {
  return useSyncExternalStore(subscribe, getSnapshot);
}
