// ToolCallCard — single tool/IPython call card. Covers status badges, the
// running spinner, the raw input toggle, and the file-edit diff default view
// with the input/output buttons.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ToolCallCard } from "../ToolCallCard";
import type { ToolCall } from "../../../ipc/contract";

const run = (over: Partial<ToolCall>): ToolCall => ({
  id: "tc-1",
  name: "read_file",
  input: '{"path": "src/a.ts"}',
  output: "42 lines read",
  status: "complete",
  ...over,
});

describe("ToolCallCard", () => {
  it("shows the tool name and complete badge", () => {
    render(<ToolCallCard call={run({})} />);
    expect(screen.getByText("read_file")).toBeInTheDocument();
    expect(screen.getByText("complete")).toBeInTheDocument();
  });

  it("shows an error badge for error status", () => {
    render(<ToolCallCard call={run({ status: "error" })} />);
    expect(screen.getByText("error")).toBeInTheDocument();
  });

  it("shows a running spinner and running badge for running status", () => {
    render(<ToolCallCard call={run({ status: "running" })} />);
    expect(screen.getByText("running")).toBeInTheDocument();
    expect(screen.getByLabelText("Tool running")).toBeInTheDocument();
  });

  it("toggles the raw input on a non-edit call", async () => {
    const user = userEvent.setup();
    render(<ToolCallCard call={run({})} />);
    expect(screen.queryByText('{"path": "src/a.ts"}')).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /input/i }));
    expect(screen.getByText('{"path": "src/a.ts"}')).toBeInTheDocument();
  });

  it("renders a unified diff as the default view for file-edit calls", () => {
    const edit: ToolCall = {
      id: "tc-2",
      name: "edit_file",
      input: JSON.stringify({ file_path: "src/a.ts", old_string: "old", new_string: "new" }),
      output: "Edited 1 insertion, 1 deletion",
      status: "complete",
    };
    const { container } = render(<ToolCallCard call={edit} />);
    expect(container.querySelector('[data-diff="true"]')).toBeInTheDocument();
    expect(screen.getByText("src/a.ts")).toBeInTheDocument();
  });

  it("shows the raw output by default on an edit call and collapses it behind the output button", async () => {
    const user = userEvent.setup();
    const edit: ToolCall = {
      id: "tc-3",
      name: "edit_file",
      input: JSON.stringify({ file_path: "a.ts", old_string: "o", new_string: "n" }),
      output: "raw output text",
      status: "complete",
    };
    render(<ToolCallCard call={edit} />);
    // Diff is the default view and the raw output is also shown by default.
    expect(screen.getByText("raw output text")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /output/i }));
    expect(screen.queryByText("raw output text")).not.toBeInTheDocument();
  });
});
