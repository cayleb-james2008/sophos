// MessageList — the scrollable transcript. Auto-sticks to the bottom while
// streaming, but releases the stick if the user scrolls up to read history.

import { useEffect, useRef } from "react";
import { tokens } from "../../design/tokens";
import type { TranscriptMessage } from "../../ipc/contract";
import { MessageRow } from "./MessageRow";

export function MessageList({ messages }: { messages: TranscriptMessage[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  // Release stick when the user scrolls up; re-engage when they return to bottom.
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    stickRef.current = nearBottom;
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        overflowX: "hidden",
        padding: `${tokens.space.xl} ${tokens.space.xl} ${tokens.space["2xl"]}`,
      }}
    >
      <div
        style={{
          maxWidth: tokens.layout.maxContentW,
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          gap: tokens.space.md,
        }}
      >
        {messages.map((m) => (
          <MessageRow key={m.id} message={m} />
        ))}
      </div>
    </div>
  );
}
