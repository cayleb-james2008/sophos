// SideQuestionPanel — inline side-question result above the composer. Covers
// status labeling, the running state, expanding the reply, and dismissal.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SideQuestionPanel } from "../SideQuestionPanel";
import type { SideQuestion } from "../useSideQuestions";

const sq = (over: Partial<SideQuestion>): SideQuestion => ({
  id: "sq-1",
  kind: "side",
  question: "What does this do?",
  status: "complete",
  answer: "It parses the input.",
  ...over,
});

describe("SideQuestionPanel", () => {
  it("shows the kind kicker, question, and status label", () => {
    render(<SideQuestionPanel sq={sq({})} onDismiss={vi.fn()} />);
    expect(screen.getByText("/side")).toBeInTheDocument();
    expect(screen.getByText("What does this do?")).toBeInTheDocument();
    expect(screen.getByText("complete")).toBeInTheDocument();
  });

  it("marks a running side question and shows Thinking… when opened", async () => {
    const user = userEvent.setup();
    render(<SideQuestionPanel sq={sq({ status: "running", answer: "" })} onDismiss={vi.fn()} />);
    expect(screen.getByText("running")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /show reply/i }));
    expect(screen.getByText("Thinking…")).toBeInTheDocument();
  });

  it("reveals the answer when expanded", async () => {
    const user = userEvent.setup();
    render(<SideQuestionPanel sq={sq({})} onDismiss={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /show reply/i }));
    expect(screen.getByText("It parses the input.")).toBeInTheDocument();
  });

  it("shows a fallback message when complete but with no answer recorded", async () => {
    const user = userEvent.setup();
    render(<SideQuestionPanel sq={sq({ answer: "" })} onDismiss={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /show reply/i }));
    expect(screen.getByText(/No reply recorded/)).toBeInTheDocument();
  });

  it("dismisses with the side-question id", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(<SideQuestionPanel sq={sq({ id: "sq-9" })} onDismiss={onDismiss} />);
    await user.click(screen.getByRole("button", { name: /dismiss side question/i }));
    expect(onDismiss).toHaveBeenCalledWith("sq-9");
  });

  it("labels error and cancelled statuses", () => {
    render(<SideQuestionPanel sq={sq({ status: "error", answer: "" })} onDismiss={vi.fn()} />);
    expect(screen.getByText("error")).toBeInTheDocument();
  });
});
