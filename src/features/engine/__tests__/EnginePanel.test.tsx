// EnginePanel.test.tsx — the in-app Engine Terminal. In the jsdom browser
// preview (no __TAURI_INTERNALS__) the panel renders the preview state with
// Restart/Stop disabled and forwards the connection state's workers to the
// graph. Covers the hidden class and the header badge.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EnginePanel } from "../EnginePanel";

const mockConn = vi.hoisted(() => ({
  rlmChildren: [
    { id: "w-1", name: "api-reviewer", status: "running" },
  ],
  status: { kind: "connected" },
}));

vi.mock("../../../ipc/client", async () => ({
  useConnectionState: () => mockConn,
}));

vi.mock("../EngineGraph", () => ({
  EngineGraph: ({ daemonAlive, sidecarAlive, workers, preview }: any) => (
    <div
      data-testid="engine-graph"
      data-daemon={String(daemonAlive)}
      data-sidecar={String(sidecarAlive)}
      data-workers={workers.length}
      data-preview={String(preview)}
    />
  ),
}));

describe("EnginePanel", () => {
  it("renders the header and browser preview state", () => {
    render(<EnginePanel open />);
    expect(screen.getByText("Engine Terminal")).toBeInTheDocument();
    expect(screen.getByText("Browser Preview")).toBeInTheDocument();
    expect(screen.getByText(/Engine not connected \(browser preview\)/i)).toBeInTheDocument();
  });

  it("disables Restart and Stop in the browser preview but keeps Clear enabled", () => {
    render(<EnginePanel open />);
    expect(screen.getByRole("button", { name: /restart/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /stop/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /clear/i })).toBeEnabled();
  });

  it("passes preview mode and the connection workers to the graph", () => {
    render(<EnginePanel open />);
    const graph = screen.getByTestId("engine-graph");
    expect(graph.dataset.preview).toBe("true");
    expect(graph.dataset.workers).toBe("1");
    expect(graph.dataset.daemon).toBe("undefined");
    expect(graph.dataset.sidecar).toBe("undefined");
  });

  it("hides the panel when open is false", () => {
    const { container } = render(<EnginePanel open={false} />);
    expect(container.querySelector(".engine-panel")?.className).toContain("engine-panel--hidden");
  });

  it("shows the panel body when open", () => {
    const { container } = render(<EnginePanel open />);
    expect(container.querySelector(".engine-panel")?.className).not.toContain("engine-panel--hidden");
  });

  it("Clear is clickable in preview", async () => {
    const user = userEvent.setup();
    render(<EnginePanel open />);
    await user.click(screen.getByRole("button", { name: /clear/i }));
    // No crash; still preview.
    expect(screen.getByText("Browser Preview")).toBeInTheDocument();
  });
});
