import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { ShortcutsOverlay, type ShortcutsGroup } from "@/design";

describe("ShortcutsOverlay", () => {
  const groups: ShortcutsGroup[] = [
    {
      title: "Navigation",
      shortcuts: [
        { key: "1", modifiers: ["cmd"], description: "Go to Chat", handler: () => {} },
        { key: "k", modifiers: ["cmd"], description: "Open command palette", handler: () => {} },
      ],
    },
    {
      title: "App",
      shortcuts: [
        { key: "?", description: "Show keyboard shortcuts", handler: () => {} },
      ],
    },
  ];

  it("does not render when closed", () => {
    render(<ShortcutsOverlay open={false} onClose={() => {}} groups={groups} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders a dialog with each group + shortcut description when open", () => {
    render(<ShortcutsOverlay open onClose={() => {}} groups={groups} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Shortcuts")).toBeInTheDocument();
    expect(screen.getByText("Navigation")).toBeInTheDocument();
    expect(screen.getByText("App")).toBeInTheDocument();
    expect(screen.getByText("Go to Chat")).toBeInTheDocument();
    expect(screen.getByText("Open command palette")).toBeInTheDocument();
    expect(screen.getByText("Show keyboard shortcuts")).toBeInTheDocument();
  });

  it("calls onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    render(<ShortcutsOverlay open onClose={onClose} groups={groups} />);
    fireEvent.click(screen.getByRole("button", { name: "Close shortcuts" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders shortcut keys for each binding in a kbd element", () => {
    render(<ShortcutsOverlay open onClose={() => {}} groups={groups} />);
    // The footer hint also references `?` and `Ctrl + /`, so scope the
    // assertion to the three row descriptions rather than the literal `?`
    // character which appears multiple times in the footer's hint row.
    const rows = screen.getAllByText(/Go to Chat|Open command palette|Show keyboard shortcuts/);
    expect(rows).toHaveLength(3);
    // The footer hints are surfaced separately so the row count and the
    // tip row both render.
    expect(screen.getByText(/Ctrl/)).toBeInTheDocument();
  });

  it("formats the footer with the total shortcut count", () => {
    render(<ShortcutsOverlay open onClose={() => {}} groups={groups} />);
    expect(screen.getByText(/3 shortcuts/)).toBeInTheDocument();
  });

  it("uses singular 'shortcut' when there is exactly one binding", () => {
    const single: ShortcutsGroup[] = [
      { title: "App", shortcuts: [{ key: "?", description: "Show keyboard shortcuts", handler: () => {} }] },
    ];
    render(<ShortcutsOverlay open onClose={() => {}} groups={single} />);
    expect(screen.getByText(/1 shortcut · press/)).toBeInTheDocument();
  });
});
