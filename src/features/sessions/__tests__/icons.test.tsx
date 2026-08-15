// icons.test.tsx — the sessions feature's hand-drawn SVG icon set. Verifies
// every exported icon renders an SVG with the correct geometry defaults and
// that size / color / strokeWidth props propagate to the element.

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  PlayIcon,
  ForkIcon,
  RefreshIcon,
  PlusIcon,
  LayersIcon,
  TargetIcon,
  TreeIcon,
  CloneIcon,
  XIcon,
  CheckIcon,
  PencilIcon,
  CpuIcon,
  ClockIcon,
} from "../icons";

const ICONS = [
  PlayIcon,
  ForkIcon,
  RefreshIcon,
  PlusIcon,
  LayersIcon,
  TargetIcon,
  TreeIcon,
  CloneIcon,
  XIcon,
  CheckIcon,
  PencilIcon,
  CpuIcon,
  ClockIcon,
];

describe("sessions feature icons", () => {
  it.each(ICONS.map((Icon) => [Icon.name, Icon]))(
    "%s renders an svg element",
    (_name, Icon) => {
      const { container } = render(<Icon />);
      const svg = container.querySelector("svg");
      expect(svg).not.toBeNull();
      expect(svg).toHaveAttribute("viewBox", "0 0 24 24");
      expect(svg).toHaveAttribute("fill", "none");
    },
  );

  it("defaults to 16px with currentColor and round joins", () => {
    const { container } = render(<PlayIcon />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("width", "16");
    expect(svg).toHaveAttribute("height", "16");
    expect(svg).toHaveAttribute("stroke", "currentColor");
    expect(svg).toHaveAttribute("stroke-width", "1.5");
    expect(svg).toHaveAttribute("stroke-linecap", "round");
    expect(svg).toHaveAttribute("stroke-linejoin", "round");
  });

  it("applies size, color, and strokeWidth props", () => {
    const { container } = render(<ForkIcon size={24} color="#f00" strokeWidth={2} />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("width", "24");
    expect(svg).toHaveAttribute("height", "24");
    expect(svg).toHaveAttribute("stroke", "#f00");
    expect(svg).toHaveAttribute("stroke-width", "2");
  });
});
