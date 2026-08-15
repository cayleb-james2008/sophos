// MessageRow — role-aware transcript row. Covers user bubbles, assistant rows
// with thinking + tool calls + retry, streaming caret / working state, error
// status, system pills, and standalone tool rows.

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MessageRow } from "../MessageRow";
import type { TranscriptMessage } from "../../../ipc/contract";

const msg = (over: Partial<TranscriptMessage>): TranscriptMessage => ({
  id: "m-1",
  role: "assistant",
  content: "hello",
  timestamp: "2026-01-01T12:00:00.000Z",
  status: "complete",
  ...over,
});

const noop = vi.fn();

describe("MessageRow", () => {
  it("renders a user message with the You header and edit action", () => {
    render(<MessageRow message={msg({ role: "user", content: "my question" })} canEdit canRetry={false} onEdit={noop} onRetry={noop} />);
    expect(screen.getByText("You")).toBeInTheDocument();
    expect(screen.getByText("my question")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /edit and resend/i })).toBeInTheDocument();
  });

  it("renders an assistant message with the Sophos header and retry action", () => {
    render(<MessageRow message={msg({ role: "assistant", content: "answer" })} canEdit={false} canRetry onEdit={noop} onRetry={noop} />);
    expect(screen.getByText("Sophos")).toBeInTheDocument();
    expect(screen.getByText("answer")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("renders a thinking block and tool calls for an assistant message", () => {
    const m = msg({
      role: "assistant",
      content: "done",
      thinking: "reasoned about it",
      toolCalls: [{ id: "tc-1", name: "read_file", output: "x", status: "complete" }],
    });
    render(<MessageRow message={m} canEdit={false} canRetry onEdit={noop} onRetry={noop} />);
    expect(screen.getByText("Thinking")).toBeInTheDocument();
    expect(screen.getByText("read_file")).toBeInTheDocument();
  });

  it("shows a streaming caret while streaming with content", () => {
    render(<MessageRow message={msg({ role: "assistant", content: "partial", status: "streaming" })} canEdit={false} canRetry={false} onEdit={noop} onRetry={noop} />);
    expect(document.querySelector(".message-row__streaming-caret")).toBeInTheDocument();
  });

  it("shows Working… for a streaming assistant with no content", () => {
    render(<MessageRow message={msg({ role: "assistant", content: "", status: "streaming" })} canEdit={false} canRetry={false} onEdit={noop} onRetry={noop} />);
    expect(screen.getByText("Working…")).toBeInTheDocument();
  });

  it("marks an assistant error message with an error label", () => {
    render(<MessageRow message={msg({ role: "assistant", content: "bad", status: "error" })} canEdit={false} canRetry onEdit={noop} onRetry={noop} />);
    expect(screen.getByText("error")).toBeInTheDocument();
  });

  it("renders a system pill", () => {
    render(<MessageRow message={msg({ role: "system", content: "checkpoint" })} canEdit={false} canRetry={false} onEdit={noop} onRetry={noop} />);
    expect(screen.getByText("checkpoint")).toBeInTheDocument();
  });

  it("renders a standalone tool row as a tool call card", () => {
    render(<MessageRow message={msg({ role: "tool", content: '{"path": "a"}' })} canEdit={false} canRetry={false} onEdit={noop} onRetry={noop} />);
    expect(document.querySelector(".tool-call-card")).toBeInTheDocument();
  });
});
