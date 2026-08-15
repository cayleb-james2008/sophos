// ThinkingBlock — collapsible reasoning block. Covers collapse/expand, the
// token-count meta, the streaming dots, and the empty/streaming body states.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ThinkingBlock } from "../ThinkingBlock";

describe("ThinkingBlock", () => {
  it("collapses by default and shows the token count meta", () => {
    render(<ThinkingBlock thinking="one two three" />);
    expect(screen.getByText("Thinking")).toBeInTheDocument();
    expect(screen.getByText("3 tokens")).toBeInTheDocument();
    expect(screen.queryByText("one two three")).not.toBeInTheDocument();
  });

  it("expands on click and reveals the reasoning text", async () => {
    const user = userEvent.setup();
    render(<ThinkingBlock thinking="reasoning here" />);
    await user.click(screen.getByRole("button", { name: /thinking/i }));
    expect(screen.getByText("reasoning here")).toBeInTheDocument();
  });

  it("reports empty when there is no thinking content", () => {
    render(<ThinkingBlock thinking="   " />);
    expect(screen.getByText("empty")).toBeInTheDocument();
  });

  it("shows streaming dots instead of a token count while streaming", () => {
    render(<ThinkingBlock thinking="some text" streaming />);
    expect(screen.queryByText(/tokens/)).not.toBeInTheDocument();
    expect(screen.queryByText("empty")).not.toBeInTheDocument();
  });

  it("starts open when defaultOpen is set", () => {
    render(<ThinkingBlock thinking="shown" defaultOpen />);
    expect(screen.getByText("shown")).toBeInTheDocument();
  });

  it("shows a placeholder body when open but empty", async () => {
    const user = userEvent.setup();
    render(<ThinkingBlock thinking="" />);
    await user.click(screen.getByRole("button", { name: /thinking/i }));
    expect(screen.getByText("Reasoning in progress…")).toBeInTheDocument();
  });
});
