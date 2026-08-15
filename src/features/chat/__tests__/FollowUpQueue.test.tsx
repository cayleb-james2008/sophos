// FollowUpQueue — pending follow-up chips below the composer input.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FollowUpQueue } from "../FollowUpQueue";

describe("FollowUpQueue", () => {
  it("renders each follow-up chip with its text and hint", () => {
    render(<FollowUpQueue followUps={[{ id: 1, text: "first" }, { id: 2, text: "second" }]} />);
    expect(screen.getByText("first")).toBeInTheDocument();
    expect(screen.getByText("second")).toBeInTheDocument();
    expect(screen.getByText(/queued · Alt\+Up to retrieve · Esc to clear/)).toBeInTheDocument();
  });

  it("still shows the hint when there are no follow-ups", () => {
    render(<FollowUpQueue followUps={[]} />);
    expect(screen.queryByText("first")).not.toBeInTheDocument();
    expect(screen.getByText(/queued/)).toBeInTheDocument();
  });

  it("surfaces the full text as a title attribute on the chip", () => {
    render(<FollowUpQueue followUps={[{ id: 1, text: "a very long follow-up text" }]} />);
    const chip = screen.getByText("a very long follow-up text").closest(".followup-chip");
    expect(chip).toHaveAttribute("title", "a very long follow-up text");
  });
});
