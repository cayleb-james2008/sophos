// icons.test.tsx — the feature-local Agents icon set. Verifies each icon
// renders an SVG with a default size and honors size/color overrides.

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  UserIcon,
  BotIcon,
  AttachIcon,
  DetachIcon,
  PulseIcon,
  RefreshIcon,
  MessageIcon,
  InboxIcon,
  LayersIcon,
  PlugIcon,
  ClockIcon,
  CheckIcon,
} from "../icons";

const ICONS: Array<[string, (p: { size?: number; color?: string }) => JSX.Element]> = [
  ["user", UserIcon],
  ["bot", BotIcon],
  ["attach", AttachIcon],
  ["detach", DetachIcon],
  ["pulse", PulseIcon],
  ["refresh", RefreshIcon],
  ["message", MessageIcon],
  ["inbox", InboxIcon],
  ["layers", LayersIcon],
  ["plug", PlugIcon],
  ["clock", ClockIcon],
  ["check", CheckIcon],
];

describe("agents icons", () => {
  it.each(ICONS)("%s renders an svg", (_name, Icon) => {
    const { container } = render(<Icon />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute("viewBox")).toBe("0 0 24 24");
  });

  it.each(ICONS)("%s defaults to 16x16 and honors size", (_name, Icon) => {
    const { container, rerender } = render(<Icon />);
    expect(container.querySelector("svg")!.getAttribute("width")).toBe("16");
    expect(container.querySelector("svg")!.getAttribute("height")).toBe("16");
    rerender(<Icon size={24} />);
    expect(container.querySelector("svg")!.getAttribute("width")).toBe("24");
    expect(container.querySelector("svg")!.getAttribute("height")).toBe("24");
  });

  it.each(ICONS)("%s applies the color as stroke", (_name, Icon) => {
    const { container } = render(<Icon color="#ff0000" />);
    expect(container.querySelector("svg")!.getAttribute("stroke")).toBe("#ff0000");
  });

  it("renders multiple icons without conflict", () => {
    const { container } = render(
      <div>
        <UserIcon size={18} />
        <AttachIcon size={18} />
        <DetachIcon size={18} />
      </div>,
    );
    expect(container.querySelectorAll("svg").length).toBe(3);
  });
});
