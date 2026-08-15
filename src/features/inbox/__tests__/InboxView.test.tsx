// InboxView.test.tsx — the agent relay. Mocks the IPC client + event stream,
// the shared graph child (InboxGraph), and the ipc/unread helper that
// useAgents pulls in, so the view's load, agent switcher, unread/mark-as-read,
// send, live event, error, and empty-state behaviour can be asserted directly.

import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InboxView } from "../InboxView";

const LOAD_TIMEOUT = 4000;

type AnyFn = (...args: never[]) => unknown;

const mockState = vi.hoisted(() => {
  const listeners: Array<(event: unknown) => void> = [];
  return {
    listeners,
    fire: (event: unknown) => {
      for (const cb of [...listeners]) cb(event);
    },
    client: {
      listAgents: vi.fn(),
      listInbox: vi.fn(),
      sendAgentMessage: vi.fn(),
      markMessageRead: vi.fn(),
    } as Record<string, AnyFn>,
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

vi.mock("../../../ipc/unread", async () => ({
  useUnreadRefresh: () => () => undefined,
}));

vi.mock("../InboxGraph", async () => ({
  InboxGraph: ({ thread, onSelectMsg, peerId }: any) => (
    <div data-testid="inbox-graph" data-thread={thread.length} data-peer={peerId}>
      {thread.map((m: any) => (
        <button key={m.id} onClick={() => onSelectMsg(m.id)}>
          {m.text}
        </button>
      ))}
    </div>
  ),
}));

const AGENTS = [
  { id: "a-1", name: "Worker", status: "running" as const },
  { id: "a-2", name: "Helper", status: "idle" as const },
];

const INBOX = [
  { id: "i1", fromAgentId: "a-1", fromAgentName: "Worker", toAgentId: "self", toAgentName: "You", text: "hello", timestamp: "2026-01-15T10:00:00.000Z", read: false },
];

function makeClient() {
  (mockState.client.listAgents as ReturnType<typeof vi.fn>).mockResolvedValue(AGENTS);
  (mockState.client.listInbox as ReturnType<typeof vi.fn>).mockResolvedValue(INBOX);
  (mockState.client.sendAgentMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "rcpt", deliveryStatus: "delivered" });
  (mockState.client.markMessageRead as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockState.listeners.length = 0;
  makeClient();
});

describe("InboxView", () => {
  it("loads agents and inbox, selects the first peer, and shows telemetry", async () => {
    render(<InboxView />);
    await waitFor(() => expect(screen.getByText("Inbox")).toBeInTheDocument());

    await waitFor(() => expect(screen.getByTestId("inbox-graph")).toHaveAttribute("data-peer", "a-1"), { timeout: LOAD_TIMEOUT });
    // The live/unread counts sit inside <b>, which getByText ignores, so match
    // against the element's full textContent.
    expect(screen.getByText((_, el) => el?.textContent === "1 live")).toBeInTheDocument();
    expect(screen.getByText((_, el) => el?.textContent === "1 unread")).toBeInTheDocument();
    expect(screen.getByText(/relay 2 agents · 1 message/)).toBeInTheDocument();
    // "Worker" appears in the chip, the composer label, and the footer.
    expect(screen.getAllByText("Worker").length).toBeGreaterThan(0);
    expect(screen.getByText("Helper")).toBeInTheDocument();
  });

  it("renders an unread badge on the peer chip with unread messages", async () => {
    render(<InboxView />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Worker/ })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Worker/ })).toHaveTextContent("1");
  });

  it("marks a peer's messages read when selected", async () => {
    render(<InboxView />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Worker/ })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /Helper/ }));
    // Back to Worker → its unread messages get marked read.
    await userEvent.click(screen.getByRole("button", { name: /Worker/ }));

    await waitFor(() => expect(mockState.client.markMessageRead).toHaveBeenCalledWith("i1"));
    // Unread count on the chip clears.
    await waitFor(() => expect(screen.getByRole("button", { name: /Worker/ })).not.toHaveTextContent("1"));
  });

  it("sends a message to the selected peer and clears the draft", async () => {
    render(<InboxView />);
    await waitFor(() => expect(screen.getByLabelText("Message agent")).toBeInTheDocument());

    const textarea = screen.getByLabelText("Message agent");
    expect(screen.getByRole("button", { name: /send message/i })).toBeDisabled();

    await userEvent.type(textarea, "do the thing");
    await userEvent.click(screen.getByRole("button", { name: /send message/i }));

    await waitFor(() => expect(mockState.client.sendAgentMessage).toHaveBeenCalledWith("a-1", "do the thing"));
    await waitFor(() => expect(textarea).toHaveValue(""));
    // Local message appended → the graph now holds 2 messages in the thread.
    await waitFor(() => expect(screen.getByTestId("inbox-graph")).toHaveAttribute("data-thread", "2"));
  });

  it("marks a message read when a message node is selected", async () => {
    render(<InboxView />);
    await waitFor(() => expect(screen.getByRole("button", { name: /hello/ })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /hello/ }));
    await waitFor(() => expect(mockState.client.markMessageRead).toHaveBeenCalledWith("i1"));
  });

  it("shows an error banner and recovers on retry", async () => {
    (mockState.client.listAgents as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error("relay down"))
      .mockResolvedValueOnce(AGENTS);
    (mockState.client.listInbox as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error("relay down"))
      .mockResolvedValueOnce(INBOX);

    render(<InboxView />);
    // The message appears in both the banner and the graph canvas empty card.
    await waitFor(() => expect(screen.getAllByText(/relay down/).length).toBeGreaterThan(0), { timeout: LOAD_TIMEOUT });

    await userEvent.click(screen.getAllByRole("button", { name: /retry/i })[0]);
    await waitFor(() => expect(screen.queryByText(/relay down/)).not.toBeInTheDocument(), { timeout: LOAD_TIMEOUT });
    expect(screen.getByTestId("inbox-graph")).toHaveAttribute("data-peer", "a-1");
  });

  it("shows an empty state with no agents or messages", async () => {
    (mockState.client.listAgents as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (mockState.client.listInbox as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    render(<InboxView />);
    await waitFor(() => expect(screen.getByText("No relay traffic yet")).toBeInTheDocument(), { timeout: LOAD_TIMEOUT });
    expect(screen.queryByTestId("inbox-graph")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Message agent")).not.toBeInTheDocument();
  });

  it("appends a message from the live agent_message event", async () => {
    render(<InboxView />);
    await waitFor(() => expect(screen.getByTestId("inbox-graph")).toHaveAttribute("data-thread", "1"));

    act(() =>
      mockState.fire({
        type: "agent_message",
        message: { id: "i2", fromAgentId: "a-1", toAgentId: "self", text: "fresh", timestamp: "2026-01-15T10:02:00.000Z", read: false },
      }),
    );

    await waitFor(() => expect(screen.getByText("fresh")).toBeInTheDocument());
    expect(screen.getByTestId("inbox-graph")).toHaveAttribute("data-thread", "2");
  });
});
