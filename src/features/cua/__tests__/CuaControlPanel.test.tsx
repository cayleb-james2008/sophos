import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CuaControlPanel } from "../CuaControlPanel";

describe("CuaControlPanel Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the CUA panel with header and status badges", async () => {
    render(<CuaControlPanel />);

    expect(screen.getByText(/Native Windows Computer-Use Action Space/i)).toBeInTheDocument();
    expect(screen.getByText(/UIA Engine Active/i)).toBeInTheDocument();
    expect(screen.getByText(/Background Guard: Enforced/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId("window-list")).toBeInTheDocument();
    });
  });

  it("loads and displays running desktop applications", async () => {
    render(<CuaControlPanel />);

    await waitFor(() => {
      expect(screen.getByTestId("win-card-win-sophos")).toBeInTheDocument();
      expect(screen.getByTestId("win-card-win-vscode")).toBeInTheDocument();
    });
  });

  it("allows selecting a window and inspects its accessibility tree", async () => {
    render(<CuaControlPanel />);

    await waitFor(() => {
      expect(screen.getByTestId("win-card-win-sophos")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("win-card-win-sophos"));

    await waitFor(() => {
      expect(screen.getByTestId("accessibility-tree")).toBeInTheDocument();
      expect(screen.getByText(/Command Palette \/ Search/i)).toBeInTheDocument();
    });
  });

  it("dispatches background action and shows execution result banner", async () => {
    render(<CuaControlPanel />);

    await waitFor(() => {
      expect(screen.getByTestId("dispatch-action-btn")).toBeInTheDocument();
    });

    const dispatchBtn = screen.getByTestId("dispatch-action-btn");
    fireEvent.click(dispatchBtn);

    await waitFor(() => {
      expect(screen.getByTestId("action-result-banner")).toBeInTheDocument();
      expect(screen.getByText(/SUCCESS/i)).toBeInTheDocument();
    });
  });
});
