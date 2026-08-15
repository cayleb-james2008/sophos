// icons.test.tsx — the inline SVG icon set. No icon library dependency; each
// icon is a hand-drawn 16px line icon. We verify the SVG contracts: correct
// viewBox, size forwarding, stroke color, and that every export renders.

import { render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import {
  ChatIcon,
  SessionsIcon,
  AgentsIcon,
  SettingsIcon,
  TerminalIcon,
  ChevronDownIcon,
  PlusIcon,
  SparkIcon,
  BoltIcon,
  SigmaGlyph,
} from "../icons";

const LINE_ICONS = [
  ChatIcon,
  SessionsIcon,
  AgentsIcon,
  SettingsIcon,
  TerminalIcon,
  ChevronDownIcon,
  PlusIcon,
  SparkIcon,
  BoltIcon,
];

describe("line icons", () => {
  it.each(LINE_ICONS.map((ic, i) => [i, ic] as const))("icon %i renders an svg", (_i, Icon) => {
    const { container } = render(<Icon />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("viewBox", "0 0 24 24");
  });

  it("defaults to 16x16 with the currentColor stroke", () => {
    const { container } = render(<ChatIcon />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("16");
    expect(svg.getAttribute("height")).toBe("16");
    expect(svg.getAttribute("stroke")).toBe("currentColor");
    expect(svg.getAttribute("fill")).toBe("none");
  });

  it("forwards size and color to the svg", () => {
    const { container } = render(<BoltIcon size={20} color="#0f0" strokeWidth={2.5} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("20");
    expect(svg.getAttribute("height")).toBe("20");
    expect(svg.getAttribute("stroke")).toBe("#0f0");
    expect(svg.getAttribute("stroke-width")).toBe("2.5");
  });

  it("passes through a style object", () => {
    const { container } = render(<PlusIcon style={{ opacity: 0.5 }} />);
    expect(container.querySelector("svg")?.getAttribute("style")).toContain("opacity");
  });
});

describe("SigmaGlyph", () => {
  it("renders the brand mark with paper stroke and green accent by default", () => {
    const { container } = render(<SigmaGlyph />);
    const svg = container.querySelector("svg")!;
    expect(svg).not.toBeNull();
    const paths = Array.from(svg.querySelectorAll("path"));
    // The Σ path + the accent rect.
    expect(paths.length).toBeGreaterThanOrEqual(1);
    expect(svg.querySelector("rect")?.getAttribute("fill")).toBe("var(--pa-green)");
  });

  it("honors custom size, stroke color, and accent", () => {
    const { container } = render(<SigmaGlyph size={24} color="#fff" accent="#0f0" />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("24");
    expect(svg.querySelector("path")?.getAttribute("stroke")).toBe("#fff");
    expect(svg.querySelector("rect")?.getAttribute("fill")).toBe("#0f0");
  });
});
