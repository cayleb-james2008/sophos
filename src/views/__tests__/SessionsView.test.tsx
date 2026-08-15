// SessionsView.test.tsx — the view-layer shim re-exports the sessions feature
// module while keeping the `./views/SessionsView` import path valid.

import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../features/sessions/SessionsView", () => ({
  SessionsView: () => <div data-testid="sessions-feature">Sessions feature body</div>,
}));

import { SessionsView } from "../SessionsView";

describe("SessionsView", () => {
  it("re-exports and renders the sessions feature module", () => {
    render(<SessionsView />);
    expect(screen.getByTestId("sessions-feature")).toBeInTheDocument();
    expect(screen.getByText("Sessions feature body")).toBeInTheDocument();
  });
});
