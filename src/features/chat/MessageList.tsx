// MessageList — the scrollable transcript. Auto-sticks to the bottom while
// streaming, but releases the stick if the user scrolls up to read history.

import { useEffect, useRef } from "react";
import { tokens } from "../../design/tokens";
import { Text } from "../../design";
import type { TranscriptMessage } from "../../ipc/contract";
import { MessageRow } from "./MessageRow";

function EmptyChatHint() {
  const hints = [
    { glyph: "@", label: "file", desc: "reference a file" },
    { glyph: "!", label: "shell", desc: "run a command" },
    { glyph: "/btw", label: "side question", desc: "ask while working" },
    { glyph: "⌘K", label: "palette", desc: "jump anywhere" },
  ];
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: tokens.space["2xl"],
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: tokens.space.lg,
          maxWidth: 460,
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontFamily: tokens.font.mono,
            fontSize: tokens.font.size.sm,
            color: tokens.color.textMuted,
            letterSpacing: "0.02em",
          }}
        >
          <span style={{ color: tokens.color.accent }}>$</span>{" "}sophos
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: tokens.space.xs }}>
          <Text variant="title">Start a conversation</Text>
          <Text variant="body" tone="muted">
            Ask for help, point at a file, or delegate a task. Sophos streams its work in real time.
          </Text>
        </div>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: tokens.space.sm,
          }}
        >
          {hints.map((h) => (
            <div
              key={h.label}
              style={{
                display: "flex",
                alignItems: "center",
                gap: tokens.space.xs,
                padding: "4px 10px",
                borderRadius: tokens.radius.md,
                background: tokens.color.bgRaised,
                border: `1px solid ${tokens.color.border}`,
              }}
            >
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

  // First-run: no transcript yet — show a guided empty state instead of a blank page.
  if (messages.length === 0) {
    return <EmptyChatHint />;
  }

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
