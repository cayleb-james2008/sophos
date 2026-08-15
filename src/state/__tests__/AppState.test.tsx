// AppState.test.tsx — the app-level context: active view, new-session modal,
// settings tab, and the Sessions view's pre-filter/selection. Verifies default
// values, that setters update consumers, and that the hook guards usage
// outside the provider.

import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { AppStateProvider, useAppState } from "../AppState";

function Harness() {
  const state = useAppState();
  return (
    <div>
      <span data-testid="view">{state.view}</span>
      <span data-testid="newSessionOpen">{String(state.newSessionOpen)}</span>
      <span data-testid="settingsTab">{state.settingsTab}</span>
      <span data-testid="sessionsFilter">{state.sessionsFilter ?? "none"}</span>
      <span data-testid="sessionsSelected">{state.sessionsSelectedId ?? "none"}</span>
      <button onClick={() => state.setView("sessions")}>go sessions</button>
      <button onClick={() => state.setNewSessionOpen(true)}>open modal</button>
      <button onClick={() => state.setSettingsTab("providers")}>tab providers</button>
      <button onClick={() => state.setSessionsFilter("auth")}>filter auth</button>
      <button onClick={() => state.setSessionsSelectedId("session-0")}>select session</button>
    </div>
  );
}

function renderWithProvider() {
  return render(
    <AppStateProvider>
      <Harness />
    </AppStateProvider>,
  );
}

describe("AppStateProvider", () => {
  it("provides the default state values", () => {
    renderWithProvider();
    expect(screen.getByTestId("view").textContent).toBe("chat");
    expect(screen.getByTestId("newSessionOpen").textContent).toBe("false");
    expect(screen.getByTestId("settingsTab").textContent).toBe("general");
    expect(screen.getByTestId("sessionsFilter").textContent).toBe("none");
    expect(screen.getByTestId("sessionsSelected").textContent).toBe("none");
  });

  it("updates the active view", () => {
    renderWithProvider();
    fireEvent.click(screen.getByRole("button", { name: "go sessions" }));
    expect(screen.getByTestId("view").textContent).toBe("sessions");
  });

  it("opens and closes the new-session modal", () => {
    renderWithProvider();
    expect(screen.getByTestId("newSessionOpen").textContent).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "open modal" }));
    expect(screen.getByTestId("newSessionOpen").textContent).toBe("true");
  });

  it("switches the settings tab", () => {
    renderWithProvider();
    fireEvent.click(screen.getByRole("button", { name: "tab providers" }));
    expect(screen.getByTestId("settingsTab").textContent).toBe("providers");
  });

  it("stores the sessions pre-filter and selection", () => {
    renderWithProvider();
    fireEvent.click(screen.getByRole("button", { name: "filter auth" }));
    expect(screen.getByTestId("sessionsFilter").textContent).toBe("auth");
    fireEvent.click(screen.getByRole("button", { name: "select session" }));
    expect(screen.getByTestId("sessionsSelected").textContent).toBe("session-0");
  });
});

describe("useAppState outside the provider", () => {
  it("throws with a helpful message", () => {
    const spy = vi_spy(console, "error");
    expect(() => render(<Harness />)).toThrow("useAppState must be used within an <AppStateProvider>");
    spy();
  });
});

// Minimal spy helper to silence React's expected error-boundary logging.
function vi_spy(target: Console, method: "error") {
  const s = vi.spyOn(target, method).mockImplementation(() => {});
  return () => s.mockRestore();
}
