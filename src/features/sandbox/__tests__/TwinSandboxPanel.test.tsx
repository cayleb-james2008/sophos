import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TwinSandboxPanel } from "../TwinSandboxPanel";

describe("TwinSandboxPanel Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders header and isolation status badges", async () => {
    render(<TwinSandboxPanel />);

    expect(
      screen.getByRole("heading", {
        name: /Ephemeral Workspace Twin Sandbox/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Isolation: Zero-Copy Worktree/i)).toBeInTheDocument();
  });

  it("lists active workspace twins and inspects twin diff", async () => {
    render(<TwinSandboxPanel />);

    await waitFor(() => {
      expect(screen.getByTestId("twin-card-twin-refactor-security")).toBeInTheDocument();
      expect(screen.getByTestId("twin-card-twin-vitest-migration")).toBeInTheDocument();
    });

    const secondTwin = screen.getByTestId("twin-card-twin-vitest-migration");
    fireEvent.click(secondTwin);

    await waitFor(() => {
      expect(screen.getByTestId("twin-diff-preview")).toBeInTheDocument();
    });
  });

  it("spawns a new zero-copy ephemeral workspace twin", async () => {
    render(<TwinSandboxPanel />);

    const input = screen.getByTestId("input-twin-name");
    fireEvent.change(input, { target: { value: "feature-spec-evaluator" } });

    const spawnBtn = screen.getByTestId("btn-create-twin");
    fireEvent.click(spawnBtn);

    await waitFor(() => {
      expect(screen.getByTestId("twin-status-banner")).toBeInTheDocument();
    });
  });

  it("executes commands inside isolated twin", async () => {
    render(<TwinSandboxPanel />);

    await waitFor(() => {
      expect(screen.getByTestId("twin-card-twin-refactor-security")).toBeInTheDocument();
    });

    const execBtn = screen.getByTestId("btn-exec-in-twin");
    fireEvent.click(execBtn);

    await waitFor(() => {
      expect(screen.getByTestId("twin-exec-output")).toBeInTheDocument();
    });
  });

  it("merges verified twin changes into primary workspace", async () => {
    render(<TwinSandboxPanel />);

    await waitFor(() => {
      expect(screen.getByTestId("twin-card-twin-refactor-security")).toBeInTheDocument();
    });

    const mergeBtn = screen.getByTestId("btn-merge-twin");
    fireEvent.click(mergeBtn);

    await waitFor(() => {
      expect(screen.getByTestId("twin-status-banner")).toHaveTextContent(/Merged twin/i);
    });
  });
});
