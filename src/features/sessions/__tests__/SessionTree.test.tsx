// SessionTree.test.tsx — the context-tree view of a session. Mocks the IPC
// client (getSessionTree / navigateTree) and the event stream used by
// useSessionEvent, then exercises load success, empty + error states, branch
// counting, collapse/expand, node preview + "Continue from here", and the
// tree-event-triggered reload.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo } from "../../../ipc/contract";
import { SessionTree } from "../SessionTree";

const mockState = vi.hoisted(() => {
  const listeners: Array<(event: unknown) => void> = [];
  return {
    listeners,
    fire: (event: unknown) => {
      for (const cb of [...listeners]) cb(event);
    },
    client: {
      getSessionTree: vi.fn(),
      navigateTree: vi.fn(),
    } as Record<string, unknown>,
  };
});

vi.mock("../../../ipc/client", async () => {
  const { useEffect, useRef } = await import("react");
  return {
    useIpc: () => mockState.client,
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
    useConnectionState: () => ({ status: { kind: "connected" } }),
    isTauri: false,
  };
});

const session: SessionInfo = { id: "s-1", title: "Refactor", status: "active" };

// root has a child, b has a child → 2 branches.
const TREE = {
  tree: [
    {
      id: "entry-1",
      type: "message",
      label: "Initial brief for the session",
      timestamp: "2026-01-15T10:00:00.000Z",
      parentId: null,
      children: [
        { id: "entry-2", type: "message", label: "Agent reply", timestamp: "2026-01-15T10:01:00.000Z", parentId: "entry-1" },
        {
          id: "entry-3",
          type: "tool",
          label: "Run migration",
          parentId: "entry-1",
          children: [{ id: "entry-4", type: "user", label: "Verify migration", parentId: "entry-3" }],
        },
      ],
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockState.listeners.length = 0;
  (mockState.client.getSessionTree as ReturnType<typeof vi.fn>).mockResolvedValue(TREE);
  (mockState.client.navigateTree as ReturnType<typeof vi.fn>).mockResolvedValue({ cancelled: false });
});

describe("SessionTree", () => {
  it("shows a placeholder when no session is selected", () => {
    render(<SessionTree session={null} />);
    expect(screen.getByText("Select a session")).toBeInTheDocument();
    expect(screen.getByText(/Pick a session/)).toBeInTheDocument();
  });

  it("loads and renders the tree with a branch count", async () => {
    render(<SessionTree session={session} />);
    await waitFor(() => expect(screen.getByText("2 branches")).toBeInTheDocument());
    expect(screen.getByText(/Initial brief for the session/)).toBeInTheDocument();
    expect(screen.getByText(/Agent reply/)).toBeInTheDocument();
    expect(screen.getByText(/Verify migration/)).toBeInTheDocument();
    expect(mockState.client.getSessionTree).toHaveBeenCalledTimes(1);
  });

  it("renders a graceful empty state for an empty tree", async () => {
    (mockState.client.getSessionTree as ReturnType<typeof vi.fn>).mockResolvedValue({ tree: [] });
    render(<SessionTree session={session} />);
    await waitFor(() => expect(screen.getByText("No tree yet")).toBeInTheDocument());
    expect(screen.getByText(/no entries to branch on/)).toBeInTheDocument();
  });

  it("surfaces an error with a Retry that reloads and recovers", async () => {
    (mockState.client.getSessionTree as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error("daemon unreachable"))
      .mockResolvedValueOnce(TREE);

    render(<SessionTree session={session} />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByText(/daemon unreachable/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect(screen.getByText("2 branches")).toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("collapses and expands a branch via its caret", async () => {
    render(<SessionTree session={session} />);
    await waitFor(() => expect(screen.getByText("2 branches")).toBeInTheDocument());

    // Collapse the root branch → descendants hidden.
    const caret = document.querySelector(".session-tree__caret") as HTMLElement;
    fireEvent.click(caret);
    expect(screen.queryByText(/Agent reply/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand" })).toBeInTheDocument();

    // Expand it again → descendants return.
    fireEvent.click(document.querySelector(".session-tree__caret") as HTMLElement);
    expect(screen.getByText(/Agent reply/)).toBeInTheDocument();
  });

  it("previews a node and continues from it via navigateTree", async () => {
    render(<SessionTree session={session} />);
    await waitFor(() => expect(screen.getByText("2 branches")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /Initial brief for the session/i }));
    // Preview appears with the node text and the continue action.
    expect(screen.getByRole("button", { name: /continue from here/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /continue from here/i }));
    await waitFor(() => expect(mockState.client.navigateTree).toHaveBeenCalledWith("entry-1"));
    expect(screen.getByText(/Navigated — continue from this point/)).toBeInTheDocument();
  });

  it("reloads the tree when a matching tree event arrives", async () => {
    render(<SessionTree session={session} />);
    await waitFor(() => expect(mockState.client.getSessionTree).toHaveBeenCalledTimes(1));

    act(() => mockState.fire({ type: "session_event", event: { kind: "tree" } }));
    await waitFor(() => expect(mockState.client.getSessionTree).toHaveBeenCalledTimes(2));
  });
});
