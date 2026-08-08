// ViewScaffold — shared layout for each routed view: a header (index, title,
// description) and a body area.

import React from "react";
import { tokens } from "../design/tokens";
import { Text } from "../design";

export function ViewScaffold({
  index,
  title,
  description,
  children,
}: {
  index: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        padding: tokens.space.xl,
        gap: tokens.space.xl,
      }}
    >
      <header style={{ display: "flex", flexDirection: "column", gap: tokens.space.xs, paddingBottom: tokens.space.md, borderBottom: `1px solid ${tokens.color.border}` }}>
        <Text variant="micro" tone="dim" mono uppercase style={{ letterSpacing: "0.14em" }}>
          {index}
        </Text>
        <Text as="h1" style={{ fontFamily: tokens.font.display, fontSize: tokens.font.size["2xl"], fontWeight: 600, lineHeight: 1.15, letterSpacing: "-0.015em", color: tokens.color.text, margin: 0 }}>
          {title}
        </Text>
        <Text variant="body" tone="muted">
          {description}
        </Text>
      </header>
      <div style={{ flex: 1, minHeight: 0 }}>{children}</div>
    </div>
  );
}
