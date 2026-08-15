// nav.test.ts — the shell navigation model. Asserts the stable nav item list:
// ordering, ids, labels, hints, and that each icon renders an SVG.

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { NAV_ITEMS, type View } from "../nav";

describe("NAV_ITEMS", () => {
  it("exposes the five core views in a stable order", () => {
    expect(NAV_ITEMS.map((n) => n.id)).toEqual(["chat", "sessions", "agents", "inbox", "settings"]);
  });

  it("renders a human label and help hint per item", () => {
    for (const item of NAV_ITEMS) {
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.hint.length).toBeGreaterThan(0);
    }
    expect(NAV_ITEMS.find((n) => n.id === "chat")?.label).toBe("Chat");
    expect(NAV_ITEMS.find((n) => n.id === "inbox")?.hint).toContain("relay");
  });

  it("provides an icon renderer for every item that renders an SVG", () => {
    for (const item of NAV_ITEMS) {
      const Icon = item.icon;
      const { container } = render(<Icon size={16} color="red" />);
      const svg = container.querySelector("svg");
      expect(svg, `${item.id} icon`).not.toBeNull();
      expect(svg?.getAttribute("width")).toBe("16");
    }
  });

  it("has unique ids that are all valid View values", () => {
    const ids = NAV_ITEMS.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(["chat", "sessions", "agents", "inbox", "settings"]).toContain(id satisfies View);
    }
  });
});
