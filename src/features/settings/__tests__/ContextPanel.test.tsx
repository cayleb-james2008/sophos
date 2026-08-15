// ContextPanel.test.tsx — ContextPanel renders token usage as a gauge with a
// computed percentage, shows messages / compaction stats, and wires Compact
// to onCompact.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ContextPanel } from "../ContextPanel";
import type { ContextStats } from "../../../ipc/contract";

describe("ContextPanel", () => {
  it("renders token counts and a computed percentage", () => {
    const context: ContextStats = { tokens: 25000, contextWindow: 100000, messages: 12 };
    render(<ContextPanel context={context} onCompact={vi.fn()} />);

    // formatTokens(25000) -> "25.0k"; "of 100.0k · 25%"
    expect(screen.getByText("25.0k")).toBeInTheDocument();
    expect(screen.getByText(/of 100\.0k · 25%/)).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("clamps the percentage at 100 when tokens exceed the window", () => {
    const context: ContextStats = { tokens: 500, contextWindow: 100 };
    render(<ContextPanel context={context} onCompact={vi.fn()} />);
    expect(screen.getByText(/100%/)).toBeInTheDocument();
  });

  it("handles a zero context window without dividing by zero", () => {
    render(<ContextPanel context={{ tokens: 10, contextWindow: 0 }} onCompact={vi.fn()} />);
    expect(screen.getByText(/0%/)).toBeInTheDocument();
  });

  it("shows 'Never' and an em-dash when no compaction occurred", () => {
    render(<ContextPanel context={{ tokens: 10, contextWindow: 100 }} onCompact={vi.fn()} />);
    expect(screen.getByText("Never")).toBeInTheDocument();
    // "Last compacted" is "Never"; compaction reason and an unset message both show "—".
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(1);
  });

  it("renders compaction timestamp and reason when present", () => {
    const context: ContextStats = {
      tokens: 10,
      contextWindow: 100,
      messages: 3,
      compaction: { lastCompactedAt: "2026-08-01T12:00:00Z", reason: "window_full" },
    };
    render(<ContextPanel context={context} onCompact={vi.fn()} />);
    const expected = new Date("2026-08-01T12:00:00Z").toLocaleString();
    expect(screen.getByText(expected)).toBeInTheDocument();
    expect(screen.getByText("window_full")).toBeInTheDocument();
  });

  it("calls onCompact when Compact is clicked", async () => {
    const user = userEvent.setup();
    const onCompact = vi.fn();
    render(<ContextPanel context={{ tokens: 10, contextWindow: 100 }} onCompact={onCompact} />);

    await user.click(screen.getByRole("button", { name: /compact/i }));

    expect(onCompact).toHaveBeenCalledTimes(1);
  });
});
