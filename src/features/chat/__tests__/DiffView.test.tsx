// DiffView — unified diff renderer for file-edit tool calls. Covers the file
// path header, add/remove counts, per-line tint markers, and the copy
// affordances (copy diff / copy path) via the clipboard API.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DiffView } from "../DiffView";
import { diffLines } from "../diff";

const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, "clipboard", {
    value: clipboard,
    configurable: true,
  });
});

describe("DiffView", () => {
  it("renders the file path and add/remove counts", () => {
    const lines = diffLines("a\nb", "a\nc");
    render(<DiffView filePath="src/x.ts" lines={lines} unified="--- / +++" />);
    expect(screen.getByText("src/x.ts")).toBeInTheDocument();
    expect(screen.getByText("+1")).toBeInTheDocument();
    expect(screen.getByText("−1")).toBeInTheDocument();
  });

  it("marks added and removed lines with data attributes and signs", () => {
    const lines = diffLines("a\nb", "a\nc");
    const { container } = render(<DiffView filePath="f" lines={lines} unified="u" />);
    const addLines = container.querySelectorAll('[data-diff-add="true"]');
    const removeLines = container.querySelectorAll('[data-diff-remove="true"]');
    expect(addLines).toHaveLength(1);
    expect(removeLines).toHaveLength(1);
    expect(addLines[0].textContent).toContain("c");
    expect(removeLines[0].textContent).toContain("b");
  });

  it("falls back to an unknown-path label when filePath is empty", () => {
    render(<DiffView filePath="" lines={[]} unified="" />);
    expect(screen.getByText("(unknown path)")).toBeInTheDocument();
  });

  it("copies the unified diff and the path via the clipboard", () => {
    // fireEvent (not userEvent) so our navigator.clipboard mock is not
    // replaced by user-event's own clipboard implementation.
    render(<DiffView filePath="src/x.ts" lines={[]} unified="diff-body" />);
    fireEvent.click(screen.getByRole("button", { name: /copy diff/i }));
    expect(clipboard.writeText).toHaveBeenCalledWith("diff-body");

    fireEvent.click(screen.getByRole("button", { name: /copy path/i }));
    expect(clipboard.writeText).toHaveBeenCalledWith("src/x.ts");
  });
});
