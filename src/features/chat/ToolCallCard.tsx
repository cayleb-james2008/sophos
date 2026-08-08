// ToolCallCard — renders a single tool / IPython call: name, input, output,
// and a live status (running / complete / error). Terminal-style output block.

import { useState } from "react";
import { tokens } from "../../design/tokens";
import { Text, Badge, type BadgeTone } from "../../design";
import type { ToolCall } from "../../ipc/contract";
import { HighlightedCode, detectLang } from "./highlight";

function ToolIcon({ size = 13, color }: { size?: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

function statusMeta(status: ToolCall["status"]): { tone: BadgeTone; label: string } {
  switch (status) {
    case "running":
      return { tone: "info", label: "running" };
    case "error":
      return { tone: "danger", label: "error" };
    case "complete":
    default:
      return { tone: "success", label: "complete" };
  }
}

export function ToolCallCard({ call }: { call: ToolCall }) {
  const [showInput, setShowInput] = useState(false);
  const [showOutput, setShowOutput] = useState(true);
  const meta = statusMeta(call.status);
  const hasInput = !!call.input;
  const hasOutput = !!call.output;

  return (
    <div
      style={{
        border: `1px solid ${tokens.color.border}`,
        borderRadius: tokens.radius.md,
        background: tokens.color.bgElevated,
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: tokens.space.sm,
          padding: "7px 12px",
          borderBottom: hasOutput || hasInput ? `1px solid ${tokens.color.border}` : "none",
        }}
      >
        <ToolIcon color={call.status === "error" ? tokens.color.danger : tokens.color.info} />
        <span
          style={{
            fontFamily: tokens.font.mono,
            fontSize: 12.5,
            lineHeight: 1,
            color: tokens.color.accent,
            userSelect: "none",
          }}
        >
          $
        </span>
        <Text variant="label" weight="medium" mono style={{ fontSize: 12.5 }}>
          {call.name}
        </Text>
        <Badge tone={meta.tone} dot>
          {meta.label}
        </Badge>
        {call.status === "running" ? (
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              border: `2px solid ${tokens.color.borderStrong}`,
              borderTopColor: tokens.color.info,
              animation: "pa-spin 0.8s linear infinite",
              marginLeft: 2,
            }}
          />
        ) : null}
        {hasInput ? (
          <button
            type="button"
            onClick={() => setShowInput((s) => !s)}
            className="pa-focus-ring"
            style={{
              marginLeft: "auto",
              background: "transparent",
              border: "none",
              color: tokens.color.textDim,
              cursor: "pointer",
              fontFamily: tokens.font.sans,
              fontSize: tokens.font.size.xs,
              padding: "2px 6px",
              borderRadius: tokens.radius.sm,
            }}
          >
            {showInput ? "hide input" : "input"}
          </button>
        ) : null}
      </div>

      {/* Input */}
      {hasInput && showInput ? (
        <div
          style={{
            padding: `${tokens.space.sm} ${tokens.space.md}`,
            borderBottom: `1px solid ${tokens.color.border}`,
            background: tokens.color.bg,
          }}
        >
          <Text variant="micro" tone="dim" mono uppercase style={{ marginBottom: tokens.space.xs }}>
            Input
          </Text>
          <pre
            style={{
              margin: 0,
              fontFamily: tokens.font.mono,
              fontSize: tokens.font.size.xs,
              lineHeight: 1.6,
              color: tokens.color.textMuted,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {call.input}
          </pre>
        </div>
      ) : null}

      {/* Output */}
      {hasOutput ? (
        <div style={{ padding: `${tokens.space.sm} ${tokens.space.md}`, background: tokens.color.bg }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: tokens.space.xs,
            }}
          >
            <Text variant="micro" tone="dim" mono uppercase>
              Output
            </Text>
            <button
              type="button"
              onClick={() => setShowOutput((s) => !s)}
              className="pa-focus-ring"
              style={{
                background: "transparent",
                border: "none",
                color: tokens.color.textDim,
                cursor: "pointer",
                fontFamily: tokens.font.sans,
                fontSize: tokens.font.size.xs,
                padding: "2px 6px",
                borderRadius: tokens.radius.sm,
              }}
            >
              {showOutput ? "collapse" : "expand"}
            </button>
          </div>
          {showOutput ? (
            <HighlightedCode
              code={call.output ?? ""}
              lang={detectLang(call.output ?? "")}
              style={{
                maxHeight: 200,
                overflowY: "auto",
                color: call.status === "error" ? tokens.color.danger : undefined,
              }}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
