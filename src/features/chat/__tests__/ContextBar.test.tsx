// ContextBar — compact usage strip. Covers token/window/message formatting,
// the computed usage percent, the progressbar ARIA attributes, and the warn
// state above 80%.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ContextBar } from "../ContextBar";

describe("ContextBar", () => {
  it("renders nothing meaningful for null stats", () => {
    render(<ContextBar stats={null} />);
    expect(screen.getByText("context")).toBeInTheDocument();
    expect(screen.getByText("— tokens")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("formats thousands and millions compactly", () => {
    render(<ContextBar stats={{ tokens: 18432, contextWindow: 1000000, messages: 42 }} />);
    expect(screen.getByText("18.4k tokens")).toBeInTheDocument();
    // The window is rendered as "/ 1M" across text nodes, so match a substring.
    expect(screen.getByText(/1M/)).toBeInTheDocument();
    expect(screen.getByText("42 messages")).toBeInTheDocument();
  });

  it("shows a progressbar with computed aria values", () => {
    render(<ContextBar stats={{ tokens: 25000, contextWindow: 100000, messages: 10 }} />);
    const meter = screen.getByRole("progressbar", { name: /context usage/i });
    expect(meter).toHaveAttribute("aria-valuenow", "25");
    expect(meter).toHaveAttribute("aria-valuemin", "0");
    expect(meter).toHaveAttribute("aria-valuemax", "100");
    expect(meter).toHaveAttribute("title", "25.0% of context window");
  });

  it("caps the percent at 100", () => {
    render(<ContextBar stats={{ tokens: 500, contextWindow: 100, messages: 1 }} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  });

  it("flags the meter as warning above 80% usage", () => {
    render(<ContextBar stats={{ tokens: 900, contextWindow: 1000, messages: 1 }} />);
    const fill = document.querySelector(".context-bar-meter-fill");
    expect(fill).toHaveClass("context-bar-meter-fill--warn");
  });

  it("omits the meter when the window is missing or zero", () => {
    render(<ContextBar stats={{ tokens: 10, messages: 1 }} />);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
});
