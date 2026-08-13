// MessageList — the scrollable transcript. Auto-sticks to the bottom while
// streaming, but releases the stick if the user scrolls up to read history.
//
// Long transcripts are windowed: only the rows intersecting the viewport (plus
// an overscan buffer) are mounted, so a 500+ message conversation renders and
// scrolls without a main-thread freeze. Row heights are measured live (see
// useVirtualList) so the scrollbar and the auto-stick stay accurate even while
// a streaming message grows.

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Text, Button } from "../../design";
import type { TranscriptMessage } from "../../ipc/contract";
import { MessageRow } from "./MessageRow";
import { useVirtualList } from "./useVirtualList";
import { useMessageFocusRequest, clearMessageFocus } from "./chatBridge";

// Fallback row height for unmeasured rows (thinking blocks / tool cards /
// markdown vary a lot; measured heights take over as rows render).
const ROW_ESTIMATE = 120;
const OVERSCAN = 8;

// Suggested starter prompts shown in the empty state. Clicking one fills the
// composer (the user edits before sending) — it does NOT auto-send.
const STARTER_PROMPTS = [
  "Help me debug a function",
  "Explain this codebase",
  "Write a test for my module",
  "Refactor this file",
];

function ChatEmptyState({ onFillPrompt }: { onFillPrompt: (text: string) => void }) {
  const hints = [
    { glyph: "@", label: "file", desc: "reference a file" },
    { glyph: "!", label: "shell", desc: "run a command" },
    { glyph: "/btw", label: "side question", desc: "ask while working" },
    { glyph: "⌘K", label: "palette", desc: "jump anywhere" },
  ];
  return (
    <div className="msglist-empty">
      <div className="msglist-empty-inner">
        <div className="msglist-empty-prompt">
          <span className="msglist-empty-prompt-acc">$</span>{" "}sophos
        </div>
        <div className="msglist-empty-title">
          <Text variant="title">Start a conversation</Text>
          <Text variant="body" tone="muted">
            Ask for help, point at a file, or delegate a task. Sophos streams its work in real time.
          </Text>
        </div>
        {/* Clickable starter prompts — fill the composer, never auto-send. */}
        <div className="msglist-empty-starters">
          {STARTER_PROMPTS.map((p) => (
            <Button
              key={p}
              variant="outline"
              type="button"
              onClick={() => onFillPrompt(p)}
              title={`Fill composer with: ${p}`}
              aria-label={`Starter prompt: ${p}`}
              className="msglist-starter-btn"
            >
              {p}
            </Button>
          ))}
        </div>
        <div className="msglist-empty-hints">
          {hints.map((h) => (
            <div key={h.label} className="msglist-hint-chip">
              <Text variant="micro" tone="accent" mono>
                {h.glyph}
              </Text>
              <Text variant="micro" tone="muted">
                {h.label}
              </Text>
              <Text variant="micro" tone="dim">
                {h.desc}
              </Text>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function MessageList({
  messages,
  busy,
  onRetry,
  onEdit,
  hasProvider,
  onFillPrompt,
}: {
  messages: TranscriptMessage[];
  busy: boolean;
  onRetry: (message: TranscriptMessage) => void;
  onEdit: (index: number, message: TranscriptMessage) => void;
  /** True when at least one provider is connected — gates the empty state. */
  hasProvider: boolean;
  /** Picked a starter prompt in the empty state — fills the composer. */
  onFillPrompt: (text: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const focus = useMessageFocusRequest();
  const [highlightIndex, setHighlightIndex] = useState<number | null>(null);
  const highlightTimer = useRef<number | null>(null);
  // Tracks the last focus request we actually handled, so the effect fires once
  // per distinct request instead of re-arming on every height bump / scroll.
  const lastFocusSeq = useRef(0);

  const { startIndex, endIndex, topPad, bottomPad, totalHeight, onScroll, measureRowRef, reset, scrollToIndex } =
    useVirtualList({
      count: messages.length,
      estimateHeight: ROW_ESTIMATE,
      gap: 12, // tokens.space.md
      overscan: OVERSCAN,
      scrollRef,
    });

  // Drop cached row heights when the transcript identity changes (new session),
  // so stale measurements never map onto different messages. Heights are keyed
  // by index, which is safe for append-only transcripts; a mid-session insert or
  // reorder would leave stale heights until the next identity change.
  const firstId = messages[0]?.id;
  const prevFirstId = useRef(firstId);
  useEffect(() => {
    if (prevFirstId.current !== firstId) {
      prevFirstId.current = firstId;
      reset();
    }
  }, [firstId, reset]);

  // Release stick when the user scrolls up; re-engage when they return to bottom.
  const onScrollStick = () => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    stickRef.current = nearBottom;
    onScroll();
  };

  // Auto-stick to the bottom while streaming. Re-runs on message changes, on
  // height changes (totalHeight), and when the rendered window shifts so a
  // newly-appended streaming message that renders taller than its estimate
  // still keeps the view pinned to the newest content.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, totalHeight, startIndex, endIndex]);

  // Honor a message-focus request from the ⌘K transcript search: scroll the
  // target message into view and briefly highlight it. Gated on focus.seq so it
  // fires once per distinct request (not on every height bump / scroll), and the
  // request is cleared after handling so it never re-arms and fights the
  // auto-stick. If the target isn't loaded yet, we wait for messages to change.
  useEffect(() => {
    if (!focus.id) return;
    if (focus.seq === lastFocusSeq.current) return; // already handled
    const index = messages.findIndex((m) => m.id === focus.id);
    if (index < 0) return; // not loaded yet — wait for messages to change
    lastFocusSeq.current = focus.seq;
    scrollToIndex(index);
    setHighlightIndex(index);
    if (highlightTimer.current) window.clearTimeout(highlightTimer.current);
    highlightTimer.current = window.setTimeout(() => setHighlightIndex(null), 2400);
    clearMessageFocus();
  }, [focus.seq, focus.id, messages, scrollToIndex, clearMessageFocus]);

  // Clear the highlight timer on unmount.
  useEffect(() => {
    return () => {
      if (highlightTimer.current) window.clearTimeout(highlightTimer.current);
    };
  }, []);

  // Empty transcript: a provider-gated empty state. With a provider connected
  // we show the welcoming empty state with starter prompts; without one, the
  // FirstRunBanner owns the first-run experience, so we render a quiet blank
  // area rather than a competing empty state.
  if (messages.length === 0) {
    if (!hasProvider) {
      return <div className="msglist-blank" aria-hidden />;
    }
    return <ChatEmptyState onFillPrompt={onFillPrompt} />;
  }

  const visible = messages.slice(startIndex, endIndex);

  return (
    <div
      ref={scrollRef}
      onScroll={onScrollStick}
      className="msglist"
    >
      <div className="msglist-inner">
        {/* Top spacer — reserves the height of rows above the window. */}
        <div className="msglist-spacer" style={{ "--pad": `${topPad}px` } as CSSProperties} aria-hidden />

        {visible.map((m, i) => {
          const index = startIndex + i;
          // Retry is available on an assistant message when there is a preceding
          // user prompt to re-issue and the session is idle. Edit-and-resend is
          // available on a user message while idle.
          const hasPrecedingUser = messages.slice(0, index).some((x) => x.role === "user");
          return (
            <div
              key={m.id}
              data-index={index}
              data-message-id={m.id}
              ref={measureRowRef}
              className={`msglist-row${highlightIndex === index ? " msglist-row--highlight" : ""}`}
            >
              <MessageRow
                message={m}
                canRetry={m.role === "assistant" && hasPrecedingUser && !busy}
                canEdit={m.role === "user" && !busy}
                onRetry={onRetry}
                onEdit={(msg) => onEdit(index, msg)}
              />
            </div>
          );
        })}

        {/* Bottom spacer — reserves the height of rows below the window. */}
        <div className="msglist-spacer" style={{ "--pad": `${bottomPad}px` } as CSSProperties} aria-hidden />
      </div>
    </div>
  );
}
