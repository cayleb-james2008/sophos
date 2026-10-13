import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { SquadWorkflowGraph } from "../SquadWorkflowGraph";

describe("SquadWorkflowGraph (Dynamic Multi-Agent DAG Topology)", () => {
  it("renders the workflow graph container and topology options", async () => {
    render(<SquadWorkflowGraph />);
    expect(screen.getByTestId("squad-workflow-graph")).toBeInTheDocument();
    expect(screen.getByText("Sequential Pipeline")).toBeInTheDocument();
    expect(screen.getByText("Hierarchical Squad")).toBeInTheDocument();
    expect(screen.getByText("Consensus Synthesis")).toBeInTheDocument();
  });

  it("renders nodes with active running state and advances via Step Next", async () => {
    render(<SquadWorkflowGraph />);
    await waitFor(() => {
      expect(screen.getByTestId("node-node-planner")).toBeInTheDocument();
      expect(screen.getByTestId("node-node-coder")).toBeInTheDocument();
    });

    const stepBtn = screen.getByText("Step Next Node");
    fireEvent.click(stepBtn);

    await waitFor(() => {
      expect(screen.getByTestId("node-node-critic")).toHaveClass("squad-node-card--active");
    });
  });

  it("switches topology on click", async () => {
    render(<SquadWorkflowGraph />);
    const hierBtn = screen.getByText("Hierarchical Squad");
    fireEvent.click(hierBtn);

    await waitFor(() => {
      expect(screen.getByText(/HIERARCHICAL/i)).toBeInTheDocument();
    });
  });
});
