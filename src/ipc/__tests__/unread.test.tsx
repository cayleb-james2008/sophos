// unread.test.tsx — the cross-view unread badge state. UnreadProvider loads the
// inbox once on mount, subscribes to agent_message events to stay live, and
// re-derives from listInbox on agent_list events. Messages from `self` or
// already-read are ignored. We mock the IPC client to drive it deterministically.

import { render, screen, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UnreadProvider, useUnreadBadge, useUnreadRefresh } from "../unread";

const mockState = vi.hoisted(() => {
  const listeners: Array<(event: unknown) => void> = [];
  return {
    listeners,
    fire: (event: unknown) => {
      for (const cb of [...listeners]) cb(event);
    },
    client: {
      listInbox: vi.fn(),
    },
  };
});

vi.mock("../client", async () => {
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
  };
});

function Consumer() {
  const count = useUnreadBadge();
  const refresh = useUnreadRefresh();
  return (
    <div>
      <span data-testid="count">{count}</span>
      <button onClick={() => refresh?.()}>refresh</button>
    </div>
  );
}

const from = (id: string, read?: boolean) => ({
  id: `m-${id}`,
  fromAgentId: id,
  fromAgentName: id,
  toAgentId: "self",
  text: "hello",
  read,
});

beforeEach(() => {
  mockState.listeners.length = 0;
  (mockState.client.listInbox as ReturnType<typeof vi.fn>).mockReset();
});

describe("UnreadProvider", () => {
  it("renders children and shows a zero badge when the inbox is empty", async () => {
    (mockState.client.listInbox as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    render(
      <UnreadProvider>
        <Consumer />
      </UnreadProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("count").textContent).toBe("0"));
  });

  it("counts incoming unread messages from the initial listInbox load", async () => {
    (mockState.client.listInbox as ReturnType<typeof vi.fn>).mockResolvedValue([
      from("child-1"),
      from("child-2"),
      from("self"), // self-sent — ignored
      from("child-3", true), // already read — ignored
    ]);
    render(
      <UnreadProvider>
        <Consumer />
      </UnreadProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("count").textContent).toBe("2"));
  });

  it("increments on incoming agent_message events and ignores self/read", async () => {
    (mockState.client.listInbox as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    render(
      <UnreadProvider>
        <Consumer />
      </UnreadProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("count").textContent).toBe("0"));

    act(() => {
      mockState.fire({ type: "agent_message", message: from("child-1") });
    });
    expect(screen.getByTestId("count").textContent).toBe("1");
    act(() => {
      mockState.fire({ type: "agent_message", message: from("child-2") });
    });
    expect(screen.getByTestId("count").textContent).toBe("2");
    // self + read do not bump the count.
    act(() => {
      mockState.fire({ type: "agent_message", message: from("self") });
      mockState.fire({ type: "agent_message", message: from("child-3", true) });
    });
    expect(screen.getByTestId("count").textContent).toBe("2");
  });

  it("re-derives the count from listInbox on agent_list events", async () => {
    (mockState.client.listInbox as ReturnType<typeof vi.fn>).mockResolvedValue([from("child-1")]);
    render(
      <UnreadProvider>
        <Consumer />
      </UnreadProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("count").textContent).toBe("1"));

    // Agent list refreshed — now two messages are unread.
    (mockState.client.listInbox as ReturnType<typeof vi.fn>).mockResolvedValue([from("child-1"), from("child-2")]);
    act(() => {
      mockState.fire({ type: "agent_list", agents: [] });
    });
    await waitFor(() => expect(screen.getByTestId("count").textContent).toBe("2"));
  });

  it("exposes refresh() to re-derive the count (e.g. after marking read)", async () => {
    (mockState.client.listInbox as ReturnType<typeof vi.fn>).mockResolvedValue([from("child-1")]);
    render(
      <UnreadProvider>
        <Consumer />
      </UnreadProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("count").textContent).toBe("1"));

    // Mark read → inbox now empty; refresh re-derives to zero.
    (mockState.client.listInbox as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    screen.getByRole("button", { name: "refresh" }).click();
    await waitFor(() => expect(screen.getByTestId("count").textContent).toBe("0"));
  });

  it("degrades to zero when listInbox rejects", async () => {
    (mockState.client.listInbox as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("daemon down"));
    render(
      <UnreadProvider>
        <Consumer />
      </UnreadProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("count").textContent).toBe("0"));
  });
});

describe("hooks outside the provider", () => {
  it("useUnreadBadge returns 0 and useUnreadRefresh returns undefined", () => {
    render(<Consumer />);
    expect(screen.getByTestId("count").textContent).toBe("0");
    // refresh button still renders, but refresh is undefined — clicking is a no-op.
    screen.getByRole("button", { name: "refresh" }).click();
    expect(screen.getByTestId("count").textContent).toBe("0");
  });
});
