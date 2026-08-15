// DiffView.test.tsx — renders a unified diff (added / removed / context lines)
// with the correct markers and modifier classes.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DiffView } from "../DiffView";
import type { DiffLine } from "../diff";

describe("DiffView", () => {
  it("renders nothing for an empty line list", () => {
    const { container } = render(<DiffView lines={[]} />);
    expect(container.querySelector(".lr-diff")).toBeInTheDocument();
    expect(container.querySelectorAll(".lr-diff-line")).toHaveLength(0);
  });

  it("marks added lines with + and the add class", () => {
    const lines: DiffLine[] = [
      { type: "ctx", text: "keep" },
      { type: "add", text: "new line" },
      { type: "del", text: "old line" },
    ];
    const { container } = render(<DiffView lines={lines} />);
    const rows = container.querySelectorAll(".lr-diff-line");
    expect(rows).toHaveLength(3);

    const markers = Array.from(rows).map((r) => r.querySelector(".lr-diff-marker")?.textContent);
    expect(markers).toEqual([" ", "+", "-"]);

    expect(rows[1].className).toContain("lr-diff-line--add");
    expect(rows[2].className).toContain("lr-diff-line--del");
    expect(rows[0].className).not.toContain("lr-diff-line--add");
    expect(rows[0].className).not.toContain("lr-diff-line--del");
  });

  it("renders the text of each line", () => {
    render(<DiffView lines={[{ type: "ctx", text: "alpha" }, { type: "add", text: "beta" }]} />);
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText("beta")).toBeInTheDocument();
  });

  it("shows a space placeholder for an empty line so it stays visible", () => {
    const { container } = render(<DiffView lines={[{ type: "ctx", text: "" }]} />);
    const content = container.querySelector(".lr-diff-line span:last-child");
    expect(content?.textContent).toBe(" ");
  });
});
