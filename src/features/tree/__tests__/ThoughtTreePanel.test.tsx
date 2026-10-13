import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ThoughtTreePanel } from "../ThoughtTreePanel";

describe("ThoughtTreePanel Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders header and decision tree exploration graph", async () => {
    render(<ThoughtTreePanel />);

    expect(
      screen.getByRole("heading", {
        name: /Speculative Tree-of-Thoughts Execution Engine/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Engine: Tree of Thoughts/i)).toBeInTheDocument();
  });

  it("lists tree nodes with confidence score and selects a node", async () => {
    render(<ThoughtTreePanel />);

    await waitFor(() => {
      expect(screen.getByText(/Branch A: Native Git zero-copy worktree pool/i)).toBeInTheDocument();
      expect(screen.getByText(/Branch B: Docker containerized sandbox runner/i)).toBeInTheDocument();
    });

    const diffNode = screen.getByText(/Code Diff: src-tauri\/src\/worktree\.rs/i);
    fireEvent.click(diffNode);

    await waitFor(() => {
      expect(screen.getByTestId("thought-diff-snippet")).toBeInTheDocument();
    });
  });

  it("spawns a speculative branch on a selected node", async () => {
    render(<ThoughtTreePanel />);

    await waitFor(() => {
      expect(screen.getByText(/Branch A: Native Git zero-copy worktree pool/i)).toBeInTheDocument();
    });

    const input = screen.getByTestId("input-spec-hypothesis");
    fireEvent.change(input, { target: { value: "Branch C: Ramdisk copy-on-write overlay" } });

    const spawnBtn = screen.getByTestId("btn-spawn-branch");
    fireEvent.click(spawnBtn);

    await waitFor(() => {
      expect(screen.getByText(/Branch C: Ramdisk copy-on-write overlay/i)).toBeInTheDocument();
    });
  });

  it("prunes and promotes candidate branches", async () => {
    render(<ThoughtTreePanel />);

    await waitFor(() => {
      expect(screen.getByText(/Branch A: Native Git zero-copy worktree pool/i)).toBeInTheDocument();
    });

    const branchA = screen.getByText(/Branch A: Native Git zero-copy worktree pool/i);
    fireEvent.click(branchA);

    const promoteBtn = screen.getByTestId("btn-promote-branch");
    fireEvent.click(promoteBtn);

    await waitFor(() => {
      expect(screen.getByText(/Winning Branch Active/i)).toBeInTheDocument();
    });
  });
});
