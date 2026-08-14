// ContextBar — component tests. We mock the IPC/connection layer so the bar
// renders against controllable stats and a controllable compact handler.
// Asserts: token count + percent render; clicking the bar opens the panel
// (Compact Now button appears); amber warning renders at >80% with a one-click
// compact button; clicking Compact Now calls the compact mock.

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContextBar } from "../ContextBar";

// ContextPanel is rendered by ContextBar; we don't mock it, we assert against
// its output (the "Compact Now" button). But we DO need to mock the IPC/client
// import surface that ContextPanel pulls transitively via the design system —
// which has no IPC dependency, so no mock is needed there. The real import
// chain is ContextBar → ContextPanel → ../../design (pure) + ../../ipc/contract
// (type-only). So no client mock is needed for the component tests.

const onCompact = vi.fn().mockResolvedValue(undefined);

afterEach(() => {
  vi.clearAllMocks();
});

describe("ContextBar", () => {
  it("renders token count, context window, and percent meter", () => {
    render(
      <ContextBar
        stats={{ tokens: 50000, contextWindow: 200000, messages: 12 }}
        onCompact={onCompact}
      />,
    );
    // "50k tokens" and "200k" should appear, plus "12 messages".
    expect(screen.getByText(/50k tokens/i)).toBeTruthy();
    expect(screen.getByText(/200k/)).toBeTruthy();
    expect(screen.getByText(/12 messages/i)).toBeTruthy();
    // progressbar exists
    expect(screen.getByRole("progressbar")).toBeTruthy();
  });

  it("opens the context panel when the bar is clicked (Compact Now button appears)", () => {
    render(
      <ContextBar
        stats={{ tokens: 50000, contextWindow: 200000, messages: 12 }}
        onCompact={onCompact}
      />,
    );
    // Before clicking, the panel's "Compact Now" button is not in the document.
    expect(screen.queryByText(/Compact Now/i)).toBeNull();

    // Click the bar to open the panel.
    const bar = screen.getByRole("button", { name: /Context usage details/i });
    fireEvent.click(bar);

    // The panel should now render the "Compact Now" button.
    expect(screen.getByText(/Compact Now/i)).toBeTruthy();
  });

  it("shows the amber warning with a one-click compact button when percent > 80", () => {
    render(
      <ContextBar
        stats={{ tokens: 170000, contextWindow: 200000, messages: 42 }}
        onCompact={onCompact}
      />,
    );
    // 170k/200k = 85% → amber warning should be visible.
    expect(screen.getByText(/Context near limit/i)).toBeTruthy();

    // The inline compact button (labeled "Compact") should be present.
    const compactBtn = screen.getByRole("button", { name: /^Compact$/i });
    expect(compactBtn).toBeTruthy();
  });

  it("clicking the inline Compact button calls the compact handler", async () => {
    render(
      <ContextBar
        stats={{ tokens: 170000, contextWindow: 200000, messages: 42 }}
        onCompact={onCompact}
      />,
    );
    const compactBtn = screen.getByRole("button", { name: /^Compact$/i });
    fireEvent.click(compactBtn);

    // stopPropagation should prevent the bar's onClick from also firing.
    // The compact handler should have been called exactly once.
    await waitFor(() => {
      expect(onCompact).toHaveBeenCalledTimes(1);
    });

    // The bar's onClick (panel open) should NOT have fired — the panel
    // should not be open (no "Compact Now" panel button rendered).
    expect(screen.queryByText(/Compact Now/i)).toBeNull();
  });

  it("does not show the amber warning when percent <= 80", () => {
    render(
      <ContextBar
        stats={{ tokens: 100000, contextWindow: 200000, messages: 20 }}
        onCompact={onCompact}
      />,
    );
    // 50% → no warning.
    expect(screen.queryByText(/Context near limit/i)).toBeNull();
  });
});
