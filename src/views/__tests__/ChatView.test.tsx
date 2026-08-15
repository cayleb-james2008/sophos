// ChatView.test.tsx — the chat view scaffold. It renders a ViewScaffold
// header plus the module-pending empty state.

import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { ChatView } from "../ChatView";

describe("ChatView", () => {
  it("renders the conversation scaffold header", () => {
    render(<ChatView />);
    expect(screen.getByRole("heading", { name: "Conversation" })).toBeInTheDocument();
    expect(screen.getByText(/Talk to the agent/i)).toBeInTheDocument();
  });

  it("shows the module-pending empty state with a New session action", () => {
    render(<ChatView />);
    expect(screen.getByText("No active conversation")).toBeInTheDocument();
    expect(screen.getByText("Module pending")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New session" })).toBeInTheDocument();
    expect(screen.getByText("prompt · steer · abort")).toBeInTheDocument();
  });
});
