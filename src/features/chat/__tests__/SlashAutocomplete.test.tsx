// SlashAutocomplete — the inline slash-command dropdown. Covers filter+rank,
// rendering, selection via click, mouse-enter selection, aria-selected, and the
// "N more…" overflow indicator.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SlashAutocomplete, filterSlashCommands, mergeClientSideCommands } from "../SlashAutocomplete";
import type { SlashCommand } from "../../../ipc/contract";

const CMDS: SlashCommand[] = [
  { name: "compact", description: "Compact the session context", source: "builtin" },
  { name: "refine", description: "Refine the session's goal", source: "builtin" },
  { name: "export", description: "Export session", source: "builtin" },
  { name: "model", description: "Select model", source: "builtin" },
];

function renderDropdown(query: string, overrides?: Partial<Parameters<typeof SlashAutocomplete>[0]>) {
  const props = {
    commands: CMDS,
    query,
    onSelect: vi.fn(),
    onDismiss: vi.fn(),
    selectedIndex: 0,
    onSelectedIndexChange: vi.fn(),
    ...overrides,
  };
  return { ...render(<SlashAutocomplete {...props} />), props };
}

describe("filterSlashCommands", () => {
  it("ranks exact prefix before startsWith before subsequence", () => {
    const merged = mergeClientSideCommands(CMDS);
    const matches = filterSlashCommands(merged, "cd");
    expect(matches[0].name).toBe("cd");
  });

  it("matches a partial prefix across all commands", () => {
    const names = filterSlashCommands(CMDS, "co").map((c) => c.name);
    expect(names).toContain("compact");
  });
});

describe("SlashAutocomplete", () => {
  it("returns null when nothing matches the query", () => {
    const { container } = renderDropdown("zzz");
    expect(container.firstChild).toBeNull();
  });

  it("renders matched commands as options with aria-selected", () => {
    // Empty query matches every command, so we get a stable multi-option list.
    renderDropdown("", { selectedIndex: 1 });
    const listbox = screen.getByRole("listbox", { name: /slash commands/i });
    expect(listbox).toBeInTheDocument();
    const options = screen.getAllByRole("option");
    expect(options.length).toBeGreaterThan(1);
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    expect(options[0]).toHaveAttribute("aria-selected", "false");
  });

  it("calls onSelect with the command on click", async () => {
    const user = userEvent.setup();
    const { props } = renderDropdown("");
    const option = screen.getAllByRole("option")[0];
    await user.click(option);
    expect(props.onSelect).toHaveBeenCalledTimes(1);
    expect(props.onSelect).toHaveBeenCalledWith(expect.objectContaining({ name: "compact" }));
  });

  it("calls onSelectedIndexChange on mouse enter", async () => {
    const user = userEvent.setup();
    const { props } = renderDropdown("");
    const option = screen.getAllByRole("option")[1];
    await user.hover(option);
    expect(props.onSelectedIndexChange).toHaveBeenCalledWith(1);
  });

  it("shows an overflow indicator when more than 8 match", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      name: `cmd${i}`,
      description: `d${i}`,
      source: "builtin" as const,
    }));
    renderDropdown("", { commands: many });
    expect(screen.getByText(/4 more/)).toBeInTheDocument();
  });

  it("does not show overflow when 8 or fewer match", () => {
    const eight = Array.from({ length: 8 }, (_, i) => ({ name: `c${i}`, description: `d${i}`, source: "builtin" as const }));
    renderDropdown("", { commands: eight });
    expect(screen.queryByText(/more/)).not.toBeInTheDocument();
  });
});
