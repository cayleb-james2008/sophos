import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { McpExplorer } from "../McpExplorer";

describe("McpExplorer (Model Context Protocol Standard Inspector)", () => {
  it("renders the MCP live explorer header and servers", async () => {
    render(<McpExplorer />);
    expect(screen.getByTestId("mcp-explorer")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getAllByText("filesystem")[0]).toBeInTheDocument();
      expect(screen.getByText("github")).toBeInTheDocument();
    });
  });

  it("switches tabs between Resources, Prompts, and Tools", async () => {
    render(<McpExplorer />);
    await waitFor(() => {
      expect(screen.getAllByText("filesystem")[0]).toBeInTheDocument();
    });

    // Check tabs
    const promptTab = screen.getByRole("tab", { name: /Prompts/i });
    fireEvent.click(promptTab);
    await waitFor(() => {
      expect(screen.getByText("code_review")).toBeInTheDocument();
      expect(screen.getByText("summarize_diff")).toBeInTheDocument();
    });

    const toolTab = screen.getByRole("tab", { name: /Tool Schemas/i });
    fireEvent.click(toolTab);
    await waitFor(() => {
      expect(screen.getByText("read_file")).toBeInTheDocument();
      expect(screen.getByText("write_file")).toBeInTheDocument();
    });
  });

  it("streams and inspects a selected MCP resource", async () => {
    render(<McpExplorer />);
    await waitFor(() => {
      expect(screen.getByText("Project README")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Project README"));
    await waitFor(() => {
      expect(screen.getByTestId("mcp-resource-viewer")).toBeInTheDocument();
      expect(screen.getByText(/Streaming: Project README/i)).toBeInTheDocument();
      expect(screen.getByText(/Windows-native coding agent desktop application/i)).toBeInTheDocument();
    });
  });

  it("synthesizes prompt template with arguments", async () => {
    const onInjectPrompt = vi.fn();
    render(<McpExplorer onInjectPrompt={onInjectPrompt} />);
    await waitFor(() => {
      expect(screen.getAllByText("filesystem")[0]).toBeInTheDocument();
    });

    const promptTab = screen.getByRole("tab", { name: /Prompts/i });
    fireEvent.click(promptTab);
    await waitFor(() => {
      expect(screen.getByText("code_review")).toBeInTheDocument();
    });

    const synthBtn = screen.getAllByText("Synthesize & Inject")[0];
    fireEvent.click(synthBtn);

    await waitFor(() => {
      expect(screen.getByText(/Prompt Output Preview/i)).toBeInTheDocument();
      expect(onInjectPrompt).toHaveBeenCalled();
    });
  });
});
