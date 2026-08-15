// McpServersPanel.test.tsx — McpServersPanel is a controlled component: add /
// enable / test / remove flows all delegate to the onAdd/onChange/onTest/onRemove
// props, and connection-test results surface inline.

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { McpServersPanel, type McpServer } from "../McpServersPanel";

const SERVERS: McpServer[] = [
  { name: "filesystem", command: "npx", args: ["-y", "server"], enabled: true },
  { name: "memory", command: "node", args: ["memory.js"], enabled: false },
];

describe("McpServersPanel", () => {
  it("shows an empty state when there are no servers", () => {
    render(<McpServersPanel servers={[]} onChange={vi.fn()} onAdd={vi.fn()} onTest={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText(/No MCP servers configured yet/i)).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("renders each server with command/args and an enable badge", () => {
    render(<McpServersPanel servers={SERVERS} onChange={vi.fn()} onAdd={vi.fn()} onTest={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText("filesystem")).toBeInTheDocument();
    expect(screen.getByText(/npx -y server/)).toBeInTheDocument();
    expect(screen.getByText(/node memory\.js/)).toBeInTheDocument();
    expect(screen.getByText("Enabled")).toBeInTheDocument();
    expect(screen.getByText("Disabled")).toBeInTheDocument();
  });

  it("disables Add until both Name and Command are filled", () => {
    render(<McpServersPanel servers={[]} onChange={vi.fn()} onAdd={vi.fn()} onTest={vi.fn()} onRemove={vi.fn()} />);
    const add = screen.getByRole("button", { name: "Add" });
    expect(add).toBeDisabled();
  });

  it("adds a server with trimmed fields and space-split args, then clears the form", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(<McpServersPanel servers={[]} onChange={vi.fn()} onAdd={onAdd} onTest={vi.fn()} onRemove={vi.fn()} />);

    await user.type(screen.getByLabelText("Name"), "filesystem");
    await user.type(screen.getByLabelText("Command"), "  npx  ");
    await user.type(screen.getByLabelText("Arguments"), " -y @modelcontextprotocol/server-filesystem");

    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(onAdd).toHaveBeenCalledWith("filesystem", "npx", ["-y", "@modelcontextprotocol/server-filesystem"]);
    expect(screen.getByLabelText("Name")).toHaveValue("");
    expect(screen.getByLabelText("Command")).toHaveValue("");
  });

  it("toggles a server's enabled flag via onChange", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<McpServersPanel servers={SERVERS} onChange={onChange} onAdd={vi.fn()} onTest={vi.fn()} onRemove={vi.fn()} />);

    const boxes = screen.getAllByRole("checkbox");
    await user.click(boxes[0]); // filesystem is enabled -> now disabled

    expect(onChange).toHaveBeenCalledWith([
      { name: "filesystem", command: "npx", args: ["-y", "server"], enabled: false },
      { name: "memory", command: "node", args: ["memory.js"], enabled: false },
    ]);
  });

  it("surfaces a successful connection test with latency and tool count", async () => {
    const user = userEvent.setup();
    const onTest = vi.fn().mockResolvedValue({ serverName: "filesystem", connected: true, latencyMs: 42, tools: ["read", "write"] });
    render(<McpServersPanel servers={SERVERS} onChange={vi.fn()} onAdd={vi.fn()} onTest={onTest} onRemove={vi.fn()} />);

    await user.click(screen.getAllByRole("button", { name: /test/i })[0]);

    await waitFor(() => expect(screen.getByText(/Connected · 42ms · 2 tools/)).toBeInTheDocument());
    expect(onTest).toHaveBeenCalledWith("filesystem", "npx", ["-y", "server"]);
  });

  it("surfaces a failed connection test with the error message", async () => {
    const user = userEvent.setup();
    const onTest = vi.fn().mockRejectedValue(new Error("spawn ENOENT"));
    render(<McpServersPanel servers={SERVERS} onChange={vi.fn()} onAdd={vi.fn()} onTest={onTest} onRemove={vi.fn()} />);

    await user.click(screen.getAllByRole("button", { name: /test/i })[0]);

    await waitFor(() => expect(screen.getByText(/Failed · spawn ENOENT/)).toBeInTheDocument());
  });

  it("calls onRemove with the server name", async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    render(<McpServersPanel servers={SERVERS} onChange={vi.fn()} onAdd={vi.fn()} onTest={vi.fn()} onRemove={onRemove} />);

    await user.click(screen.getByRole("button", { name: "Remove memory" }));

    expect(onRemove).toHaveBeenCalledWith("memory");
  });
});
