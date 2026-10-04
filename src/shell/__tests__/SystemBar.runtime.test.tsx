import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

const connectedState = {
  status: { kind: "connected" },
  model: { provider: "ollama-cloud", model: "deepseek-v4-flash:0731-cloud" },
  context: { tokens: 18432, contextWindow: 1000000, messages: 42 },
  activeSessionId: "session-0",
  costStats: { sessionCost: 0, totalCost: 0 },
  autonomousConfig: { active: false },
};

async function renderSystemBar(mode: "demo" | "tauri") {
  vi.resetModules();
  delete (window as any).__TAURI_INTERNALS__;
  delete (window as any).__SOPHOS_DEMO__;
  window.history.replaceState({}, "", mode === "demo" ? "/#demo" : "/");
  if (mode === "tauri") {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
  }

  const client = {
    listAgents: vi.fn().mockResolvedValue([]),
    onEvent: vi.fn(() => () => {}),
    listSessions: vi.fn().mockResolvedValue([{ id: "session-0", cwd: "C:\\demo" }]),
  };

  vi.doMock("../../ipc/client", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../ipc/client")>();
    return {
      ...actual,
      useConnectionState: () => connectedState,
      useIpc: () => client,
      useIpcEvent: () => undefined,
    };
  });
  vi.doMock("../../features/longrunning/useRefinementGate", () => ({
    useRefinementGate: () => ({ pending: null }),
  }));

  const { SystemBar } = await import("../SystemBar");
  render(<SystemBar engineOpen={false} onToggleEngine={() => {}} />);
}

afterEach(() => {
  cleanup();
  vi.doUnmock("../../ipc/client");
  vi.doUnmock("../../features/longrunning/useRefinementGate");
  vi.resetModules();
  delete (window as any).__TAURI_INTERNALS__;
  delete (window as any).__SOPHOS_DEMO__;
  window.history.replaceState({}, "", "/");
});

describe("SystemBar runtime labels", () => {
  it("renders Preview · Simulated for the actual #demo browser runtime", async () => {
    await renderSystemBar("demo");

    expect(screen.getByText("Preview · Simulated")).toBeInTheDocument();
    expect(screen.queryByText("Engine live")).not.toBeInTheDocument();
    expect(document.querySelector(".system-bar__dot--preview")).toBeInTheDocument();
  });

  it("renders Engine live for a connected non-demo Tauri shell", async () => {
    await renderSystemBar("tauri");

    expect(screen.getByText("Engine live")).toBeInTheDocument();
    expect(screen.queryByText("Preview · Simulated")).not.toBeInTheDocument();
    expect(document.querySelector(".system-bar__dot--connected")).toBeInTheDocument();
  });
});
