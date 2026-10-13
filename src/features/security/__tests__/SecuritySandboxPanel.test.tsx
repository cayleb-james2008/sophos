import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { SecuritySandboxPanel } from "../SecuritySandboxPanel";

describe("SecuritySandboxPanel (Workspace Security Sandbox & Blast Radius)", () => {
  it("renders the 4 security execution policies", async () => {
    render(<SecuritySandboxPanel />);
    expect(screen.getByTestId("security-sandbox-panel")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("Strict Sandbox")).toBeInTheDocument();
      expect(screen.getByText("Confirm Risky (Default)")).toBeInTheDocument();
      expect(screen.getByText("Permissive")).toBeInTheDocument();
      expect(screen.getByText("Network Isolated")).toBeInTheDocument();
    });
  });

  it("switches security policy on click", async () => {
    render(<SecuritySandboxPanel />);
    await waitFor(() => {
      expect(screen.getByText("Strict Sandbox")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Strict Sandbox"));
    await waitFor(() => {
      expect(screen.getByText("Strict Sandbox").closest(".security-policy-card")).toHaveClass(
        "security-policy-card--active",
      );
    });
  });

  it("runs blast radius preflight analysis and reports forbidden path hits", async () => {
    render(<SecuritySandboxPanel />);
    const runBtn = screen.getByText("Run Security Preflight");
    fireEvent.click(runBtn);

    await waitFor(() => {
      expect(screen.getByTestId("blast-radius-result")).toBeInTheDocument();
      expect(screen.getByText(/CRITICAL RISK/i)).toBeInTheDocument();
      expect(screen.getByText(/Confirmation Required/i)).toBeInTheDocument();
      expect(screen.getByText(/Forbidden Zones Hit:/i)).toBeInTheDocument();
    });
  });
});
