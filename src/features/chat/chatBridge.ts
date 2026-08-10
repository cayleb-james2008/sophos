// chatBridge.ts — a tiny shared store that lets the ⌘K palette read the live
// transcript and request a scroll-to-message, without duplicating the chat
// state engine. useChat publishes messages here; CommandPalette subscribes.
// This keeps a single source of truth for the transcript across views.

import { useSyncExternalStore } from "react";
import type { TranscriptMessage } from "../../ipc/contract";

// ---- Transcript messages ----
let messages: TranscriptMessage[] = [];
const msgListeners = new Set<() => void>();

export function setTranscriptMessages(next: TranscriptMessage[]): void {
  messages = next;
  msgListeners.forEach((l) => l());
}
function getTranscriptMessages(): TranscriptMessage[] {
  return messages;
}
function subscribeTranscript(cb: () => void): () => void {
  msgListeners.add(cb);
  return () => {
    msgListeners.delete(cb);
  };
}
/** Subscribe to the current transcript messages (shared with useChat). */
export function useTranscriptMessages(): TranscriptMessage[] {
  return useSyncExternalStore(subscribeTranscript, getTranscriptMessages);
}

// ---- Message focus request (scroll-to + highlight) ----
let focusId: string | null = null;
let focusSeq = 0;
// useSyncExternalStore requires a STABLE snapshot reference — returning a fresh
// object each call makes React think the store changed every render and loops
// forever. Cache the snapshot and replace it only when the request changes.
let focusSnapshot: { id: string | null; seq: number } = { id: null, seq: 0 };
const focusListeners = new Set<() => void>();

/** Ask the chat view to scroll to a message and briefly highlight it. */
export function requestMessageFocus(id: string): void {
  focusId = id;
  focusSeq += 1;
  focusSnapshot = { id: focusId, seq: focusSeq };
  focusListeners.forEach((l) => l());
}

/** Clear any pending message-focus request once the chat view has handled it. */
export function clearMessageFocus(): void {
  focusId = null;
  focusSeq += 1;
  focusSnapshot = { id: null, seq: focusSeq };
  focusListeners.forEach((l) => l());
}
function getFocusRequest(): { id: string | null; seq: number } {
  return focusSnapshot;
}
function subscribeFocus(cb: () => void): () => void {
  focusListeners.add(cb);
  return () => {
    focusListeners.delete(cb);
  };
}
/** Subscribe to the latest message-focus request. */
export function useMessageFocusRequest(): { id: string | null; seq: number } {
  return useSyncExternalStore(subscribeFocus, getFocusRequest);
}
