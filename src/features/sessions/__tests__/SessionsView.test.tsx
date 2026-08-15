// SessionsView.test.tsx — the session command center. Mocks the IPC client,
// the shared AppState context, and the heavier child components (SessionsGraph /
// SessionDetail / SessionTree) so the view's own orchestration — telemetry,
// filters, daemon-down banner, empty/error states, refresh, and new-session —
// runs in isolation.

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionsView } from "../SessionsView";

type AnyFn = (...args: never[]) => unknown;

const mockClient = vi.hoisted(() => ({
  listSessions: vi.fn(),
  getContextStats: vi.fn(),
  getRlmChildren: vi.fn(),
  resumeSession: vi.fn(),
  forkSession: vi.fn(),
  switchSession: vi.fn(),
} as Record<string, AnyFn>));

const mockAppState = vi.hoisted(() => ({
  sessionsFilter: undefined,
  sessionsSelectedId: undefined,
  setNewSessionOpen: vi.fn(),
}));

const mockConn = vi.hoisted(() => ({
  status: { kind: "connected" },
  activeSessionId: undefined,
  goals: [] as unknown[],
  rlmChildren: [] as unknown[],
}));

vi.mock("../../../ipc/client", async () => ({
  useIpc: () => mockClient,
  useIpcEvent: () => undefined,
  useConnectionState: () => mockConn,
  isTauri: false,
}));

vi.mock("../../../state/AppState", async () => ({
  useAppState: () => mockAppState,
}));

vi.mock("../SessionsGraph", async () => ({
  SessionsGraph: ({ sessions, onResume }: { sessions: Array<{ id: string; title?: string }>; onResume: (id: string) => void }) => (
    <div data-testid="sessions-graph">
      <span>GRAPH</span>
      {sessions.map((s) => (
        <div key={s.id} data-testid="graph-session">
          {s.title ?? s.id}
        </div>
      ))}
      <button onClick={() => onResume(sessions[0]?.id)}>graph-resume</button>
    </div>
  ),
}));

vi.mock("../SessionDetail", async () => ({
  SessionDetail: ({ session }: { session: { title?: string; id: string } }) => (
    <div data-testid="detail">DETAIL {session.title ?? session.id}</div>
  ),
}));

vi.mock("../SessionTree", async () => ({
  SessionTree: () => <div data-testid="tree">TREE</div>,
}));

const SESSIONS = [
  { id: "s-1", title: "Alpha project", status: "active" as const },
  { id: "s-2", title: "Beta migration", status: "saved" as const },
  { id: "s-3", title: "Gamma cleanup", status: "idle" as const },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockAppState.sessionsFilter = undefined;
  mockAppState.sessionsSelectedId = undefined;
  mockConn.status = { kind: "connected" };
  mockConn.activeSessionId = undefined;
  (mockClient.listSessions as ReturnType<typeof vi.fn>).mockResolvedValue(SESSIONS);
  (mockClient.getContextStats as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (mockClient.getRlmChildren as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (mockClient.resumeSession as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (mockClient.forkSession as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (mockClient.switchSession as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
});

describe("SessionsView", () => {
  it("renders the heading and active/saved telemetry", async () => {
    render(<SessionsView />);
    await waitFor(() => expect(screen.getByText("Session command center")).toBeInTheDocument());
    // Counts sit inside <b>, which getByText ignores, so match full textContent;
    // they populate only after listSessions resolves.
    await waitFor(() => expect(screen.getByText((_, el) => el?.textContent === "1 active")).toBeInTheDocument());
    expect(screen.getByText((_, el) => el?.textContent === "1 saved")).toBeInTheDocument();
    expect(screen.getByTestId("sessions-graph")).toBeInTheDocument();
  });

  it("passes every session to the graph initially", async () => {
    render(<SessionsView />);
    await waitFor(() => expect(screen.getAllByTestId("graph-session")).toHaveLength(3));
  });

  it("filters sessions by name in real time", async () => {
    render(<SessionsView />);
    await waitFor(() => expect(screen.getAllByTestId("graph-session")).toHaveLength(3));

    await userEvent.type(screen.getByLabelText("Filter sessions by name"), "alpha");
    await waitFor(() => expect(screen.getAllByTestId("graph-session")).toHaveLength(1));
    expect(screen.getByText("Alpha project")).toBeInTheDocument();
  });

  it("filters sessions by status", async () => {
    render(<SessionsView />);
    await waitFor(() => expect(screen.getAllByTestId("graph-session")).toHaveLength(3));

    await userEvent.selectOptions(screen.getByLabelText("Filter sessions by status"), "active");
    await waitFor(() => expect(screen.getAllByTestId("graph-session")).toHaveLength(1));
    expect(screen.getByText("Alpha project")).toBeInTheDocument();
  });

  it("shows a filtered-empty state and clears the filter", async () => {
    render(<SessionsView />);
    await waitFor(() => expect(screen.getAllByTestId("graph-session")).toHaveLength(3));

    await userEvent.type(screen.getByLabelText("Filter sessions by name"), "zzz");
    await waitFor(() => expect(screen.getByText("No sessions match your filter")).toBeInTheDocument());

    // The search clear button and the card clear button share the accessible
    // name, so scope to the empty-state card.
    const card = screen.getByText("No sessions match your filter").closest("div")!;
    await userEvent.click(within(card).getByRole("button", { name: /clear filter/i }));
    await waitFor(() => expect(screen.getAllByTestId("graph-session")).toHaveLength(3));
  });

  it("shows an empty state when there are no sessions", async () => {
    (mockClient.listSessions as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    render(<SessionsView />);
    await waitFor(() => expect(screen.getByText("No sessions in range")).toBeInTheDocument());
    expect(screen.getByText(/Create a session to begin persistent work/)).toBeInTheDocument();
  });

  it("shows an error state and recovers on retry", async () => {
    (mockClient.listSessions as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error("list down"))
      .mockResolvedValueOnce(SESSIONS);

    render(<SessionsView />);
    await waitFor(() => expect(screen.getByText("Sessions unavailable")).toBeInTheDocument());
    expect(screen.getByText(/list down/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() => expect(screen.getAllByTestId("graph-session")).toHaveLength(3));
  });

  it("shows the daemon-down banner and disables New session when disconnected", async () => {
    mockConn.status = { kind: "disconnected", reason: "daemon not responding" } as typeof mockConn.status;
    render(<SessionsView />);
    await waitFor(() => expect(screen.getByText("Daemon unreachable")).toBeInTheDocument());
    expect(screen.getByText(/daemon not responding/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /new session/i })).toBeDisabled();
  });

  it("opens the new-session modal via AppState", async () => {
    render(<SessionsView />);
    await waitFor(() => expect(screen.getByRole("button", { name: /new session/i })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /new session/i }));
    expect(mockAppState.setNewSessionOpen).toHaveBeenCalledWith(true);
  });

  it("surfaces a resume action error as a dismissible toast", async () => {
    (mockClient.resumeSession as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("resume boom"));
    render(<SessionsView />);
    await waitFor(() => expect(screen.getByRole("button", { name: /graph-resume/i })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /graph-resume/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByText(/Resume failed: resume boom/)).toBeInTheDocument();

    await userEvent.click(screen.getByTitle("Dismiss"));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("refreshes the session list via the toolbar Refresh button", async () => {
    render(<SessionsView />);
    await waitFor(() => expect(mockClient.listSessions).toHaveBeenCalledTimes(1));

    await userEvent.click(screen.getByRole("button", { name: /^Refresh$/ }));
    await waitFor(() => expect(mockClient.listSessions).toHaveBeenCalledTimes(2));
  });

  it("switches to the context-tree view", async () => {
    render(<SessionsView />);
    await waitFor(() => expect(screen.getByTestId("sessions-graph")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("tab", { name: /tree/i }));
    await waitFor(() => expect(screen.getByTestId("tree")).toBeInTheDocument());
  });
});
