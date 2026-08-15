// AgentsView.test.tsx — the view-layer shim re-exports the agents feature
// module while keeping the `./views/AgentsView` import path valid.

import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../features/agents/AgentsView", () => ({
  AgentsView: () => <div data-testid="agents-feature">Agents feature body</div>,
}));

import { AgentsView } from "../AgentsView";

describe("AgentsView", () => {
  it("re-exports and renders the agents feature module", () => {
    render(<AgentsView />);
    expect(screen.getByTestId("agents-feature")).toBeInTheDocument();
    expect(screen.getByText("Agents feature body")).toBeInTheDocument();
  });
});
