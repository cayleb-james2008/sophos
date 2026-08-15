// RunGuardBanner — always-visible reliability guardrails. Mocks ipc/client so
// the connection snapshot (useConnectionState) and event stream drive the
// useRunGuard-derived conditions, and prompt() routes the recovery actions.

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RunGuardBanner } from "../RunGuardBanner";

const mockState = vi.hoisted(() => {
  const listeners: Array<(event: unknown) => void> = [];
  return {
    listeners,
    fire: (event: unknown) => {
      for (const cb of [...listeners]) cb(event);
    },
    client: { prompt: vi.fn() },
    conn: {
      status: { kind: "connected" },
      goals: [],
      autonomousConfig: undefined,
      costStats: undefined,
      context: undefined,
    } as Record<string, unknown>,
  };
});

vi.mock("../../../ipc/client", async () => {
  const { useEffect, useRef } = await import("react");
  return {
    useIpc: () => mockState.client,
    useConnectionState: () => mockState.conn,
    useIpcEvent: (cb: (event: unknown) => void) => {
      const cbRef = useRef(cb);
      cbRef.current = cb;
      useEffect(() => {
        const l = (event: unknown) => cbRef.current(event);
        mockState.listeners.push(l);
        return () => {
          const i = mockState.listeners.indexOf(l);
          if (i >= 0) mockState.listeners.splice(i, 1);
        };
      }, []);
    },
  };
});

const baseConn = () => ({
  status: { kind: "connected" },
  goals: [],
  autonomousConfig: undefined,
  costStats: undefined,
  context: undefined,
});

beforeEach(() => {
  mockState.listeners.length = 0;
  mockState.conn = baseConn();
  (mockState.client.prompt as ReturnType<typeof vi.fn>).mockReset();
  (mockState.client.prompt as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
});

describe("RunGuardBanner", () => {
  it("renders nothing when there is no active loop and no trip", () => {
    render(<RunGuardBanner />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("surfaces the engine-down danger banner for an active goal loop", () => {
    mockState.conn = { ...baseConn(), status: { kind: "disconnected" }, goals: [{ id: "g1", objective: "x", status: "active" }] };
    render(<RunGuardBanner />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/engine is down/i);
    expect(alert).toHaveTextContent(/goal loop can't continue/i);
  });

  it("keeps the engine-down banner even after Dismiss (engine-down is not dismissible)", async () => {
    const user = userEvent.setup();
    mockState.conn = { ...baseConn(), status: { kind: "disconnected" }, goals: [{ id: "g1", objective: "x", status: "active" }] };
    render(<RunGuardBanner />);
    expect(screen.getByRole("alert")).toHaveTextContent(/engine is down/i);
    await user.click(screen.getByRole("button", { name: /dismiss/i }));
    // The engine-down branch returns before checking `dismissed`, so the
    // banner remains visible.
    expect(screen.getByRole("alert")).toHaveTextContent(/engine is down/i);
  });

  it("shows the budget warning for an active autonomous loop with Stop + Dismiss", async () => {
    mockState.conn = { ...baseConn(), autonomousConfig: { active: true }, costStats: { totalCost: 60 } };
    render(<RunGuardBanner />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/run budget reached/i);
    expect(screen.getByRole("button", { name: /stop autonomous/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /dismiss/i })).toBeInTheDocument();
  });

  it("stops an autonomous loop then offers Resume which restarts it", async () => {
    const user = userEvent.setup();
    mockState.conn = { ...baseConn(), autonomousConfig: { active: true }, costStats: { totalCost: 60 } };
    render(<RunGuardBanner />);

    await user.click(screen.getByRole("button", { name: /stop autonomous/i }));
    await waitFor(() => expect(mockState.client.prompt).toHaveBeenCalledWith("/autonomous off"));
    // Now paused → Resume offer.
    await waitFor(() => expect(screen.getByRole("button", { name: /resume/i })).toBeInTheDocument());
    expect(screen.getByText(/run budget reached — paused/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /resume/i }));
    await waitFor(() => expect(mockState.client.prompt).toHaveBeenCalledWith("/autonomous on"));
    // After resume the banner re-enters its grace window and disappears.
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("pauses a goal loop then offers Resume which resumes it", async () => {
    const user = userEvent.setup();
    mockState.conn = { ...baseConn(), goals: [{ id: "g1", objective: "x", status: "active" }], costStats: { totalCost: 60 } };
    render(<RunGuardBanner />);

    await user.click(screen.getByRole("button", { name: /pause goal/i }));
    await waitFor(() => expect(mockState.client.prompt).toHaveBeenCalledWith("/goal pause"));
    await waitFor(() => expect(screen.getByRole("button", { name: /resume/i })).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /resume/i }));
    await waitFor(() => expect(mockState.client.prompt).toHaveBeenCalledWith("/goal resume"));
  });

  it("dismisses the budget warning to keep going", async () => {
    const user = userEvent.setup();
    mockState.conn = { ...baseConn(), autonomousConfig: { active: true }, costStats: { totalCost: 60 } };
    render(<RunGuardBanner />);
    await user.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
