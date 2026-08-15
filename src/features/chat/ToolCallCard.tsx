// ToolCallCard — renders a single tool / IPython call: name, input, output,
// and a live status (running / complete / error). Terminal-style output block.

import { useState } from "react";
import { tokens } from "../../design/tokens";
import { Text, Badge, type BadgeTone, Button } from "../../design";
import type { ToolCall } from "../../ipc/contract";
import { HighlightedCode, detectLang } from "./highlight";
import { DiffView } from "./DiffView";
import { diffLines, formatUnified, isEditToolName, parseFileEdit } from "./diff";

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

  // File-edit detection: by tool name OR by input shape. When recognized, the
  // unified diff becomes the default view and the raw JSON is collapsed behind
  // the input/output buttons. Unrecognized input falls back to raw rendering.
  const edit = parseFileEdit(call.input, call.name);
  const isEdit = isEditToolName(call.name) || edit !== null;
  const showDiff = isEdit && edit !== null;

  return (
    <div className="tool-call-card">
      {/* Header */}
      <div
        className={`tool-call-header${!hasOutput && !hasInput ? " tool-call-header--noborder" : ""}`}
      >
        <ToolIcon color={call.status === "error" ? tokens.color.danger : tokens.color.tool} />
        <span className="tool-call-prompt">
          $
        </span>
        <Text variant="label" weight="medium" mono className="tool-call-name">
          {call.name}
        </Text>
        <Badge tone={meta.tone} dot>
          {meta.label}
        </Badge>
        {call.status === "running" ? <span className="tool-call-card__spinner" aria-label="Tool running" /> : null}
        <span key={call.status} className={`tool-call-card__state-flash tool-call-card__state-flash--${call.status}`} aria-hidden="true" />
        {hasInput ? (
          <Button
            variant="ghost"
            type="button"
            onClick={() => setShowInput((s) => !s)}
            className="tool-call-btn tool-call-btn--right"
          >
            {showInput ? "hide input" : "input"}
          </Button>
        ) : null}
        {isEdit && hasOutput ? (
          <Button
            variant="ghost"
            type="button"
            onClick={() => setShowOutput((s) => !s)}
            className="tool-call-btn"
          >
            {showOutput ? "hide output" : "output"}
          </Button>
        ) : null}
      </div>

      {/* Diff — the default view for file-edit calls */}
      {showDiff ? (
        <div className="tool-call-pad">
          <DiffView
            filePath={edit!.filePath || call.name}
            lines={diffLines(edit!.before, edit!.after)}
            unified={formatUnified(edit!.before, edit!.after, edit!.filePath || call.name)}
          />
        </div>
      ) : null}

      {/* Input */}
      {hasInput && showInput ? (
        <div className="tool-call-pad">
          <Text variant="micro" tone="dim" mono uppercase className="tool-call-label">
            Input
          </Text>
          <pre className="tool-call-pre">
            {call.input}
          </pre>
        </div>
      ) : null}

      {/* Output — for edit calls the raw output is collapsed behind the
          "output" button (the diff is the default view); for all other tools
          the existing highlighted output with collapse/expand is kept. */}
      {isEdit && hasOutput && showOutput ? (
        <div className="tool-call-pad tool-call-pad--last">
          <Text variant="micro" tone="dim" mono uppercase className="tool-call-label">
            Output
          </Text>
          <pre className="tool-call-pre">
            {call.output}
          </pre>
        </div>
      ) : null}
      {!isEdit && hasOutput ? (
        <div className="tool-call-pad">
          <div className="tool-call-outrow">
            <Text variant="micro" tone="dim" mono uppercase>
              Output
            </Text>
            <Button
              variant="ghost"
              type="button"
              onClick={() => setShowOutput((s) => !s)}
              className="tool-call-btn"
            >
              {showOutput ? "collapse" : "expand"}
            </Button>
          </div>
          {showOutput ? (
            <div className={`tool-call-output${call.status === "error" ? " tool-call-output--error" : ""}`}>
              <HighlightedCode
                code={call.output ?? ""}
                lang={detectLang(call.output ?? "")}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
