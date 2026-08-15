// chatIcons — the shared small inline SVG icons for the chat feature. Trivial
// presentational primitives: each renders an <svg> with the requested size and
// color, and ChevronIcon reflects its open state via a class.

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChevronIcon, SendIcon, StopIcon, XSmall } from "../chatIcons";

describe("chatIcons", () => {
  it("SendIcon renders an svg with the given size and color", () => {
    const { container } = render(<SendIcon size={20} color="#abc" />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("width", "20");
    expect(svg).toHaveAttribute("height", "20");
    expect(svg).toHaveAttribute("stroke", "#abc");
  });

  it("StopIcon renders an svg with its default size", () => {
    const { container } = render(<StopIcon color="#f00" />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("width", "14");
    expect(svg).toHaveAttribute("stroke", "#f00");
  });

  it("XSmall renders an svg with its default size", () => {
    const { container } = render(<XSmall color="#333" />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("width", "11");
    expect(svg).toHaveAttribute("stroke", "#333");
  });

  it("ChevronIcon reflects the open state via the is-open class", () => {
    const closed = render(<ChevronIcon open={false} color="#111" />);
    expect(closed.container.querySelector("svg")).not.toHaveClass("is-open");
    const open = render(<ChevronIcon open color="#111" />);
    expect(open.container.querySelector("svg")).toHaveClass("is-open");
  });
});
