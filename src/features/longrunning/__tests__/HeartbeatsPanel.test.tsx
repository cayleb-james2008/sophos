// HeartbeatsPanel — recurring user heartbeats with set/remove via RPC.
// Mocks ipc/client so setHeartbeat()/removeHeartbeat() and the connection
// snapshot drive the panel deterministically.

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HeartbeatsPanel, type Heartbeat } from "../HeartbeatsPanel";

const mockClient = vi.hoisted(() => ({
  setHeartbeat: vi.fn(),
  removeHeartbeat: vi.fn(),
}));

const mockConn = vi.hoisted(() => ({
  activeSessionId: "s1",
  heartbeats: undefined as any,
}));

vi.mock("../../../ipc/client", () => ({
  useIpc: () => mockClient,
  useConnectionState: () => mockConn,
}));

const seeded: Heartbeat[] = [{ id: "hb-1", interval: "every 10m", prompt: "Check the deployment", status: "active" }];

beforeEach(() => {
  vi.clearAllMocks();
  mockConn.activeSessionId = "s1";
  mockConn.heartbeats = undefined;
  (mockClient.setHeartbeat as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "hb-new", cron: "every 5 minutes", prompt: "Report progress", active: true });
  (mockClient.removeHeartbeat as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
});

describe("HeartbeatsPanel", () => {
  it("shows the none-set state when empty", () => {
    render(<HeartbeatsPanel />);
    expect(screen.getByText("none set")).toBeInTheDocument();
    expect(screen.getByText(/no heartbeats set/i)).toBeInTheDocument();
  });

  it("renders seeded heartbeats with their interval, prompt, and next-run estimate", () => {
    render(<HeartbeatsPanel initial={seeded} />);
    expect(screen.getByText("1 active")).toBeInTheDocument();
    expect(screen.getByText("every 10m")).toBeInTheDocument();
    expect(screen.getByText("Check the deployment")).toBeInTheDocument();
    expect(screen.getByText(/next run \(est\.\): in ~10 min/i)).toBeInTheDocument();
  });

  it("hydrates from the connection snapshot", async () => {
    mockConn.heartbeats = [{ id: "hb-9", interval: "*/15 * * * *", active: true }];
    render(<HeartbeatsPanel />);
    await waitFor(() => expect(screen.getByText("*/15 * * * *")).toBeInTheDocument());
    expect(screen.getByText("1 active")).toBeInTheDocument();
  });

  it("adds a heartbeat via setHeartbeat and updates the list", async () => {
    const user = userEvent.setup();
    render(<HeartbeatsPanel />);

    await user.type(screen.getByLabelText("Interval"), "every 5 minutes");
    await user.type(screen.getByLabelText("Instruction (optional)"), "Report progress");
    await user.click(screen.getByRole("button", { name: /set heartbeat/i }));

    await waitFor(() => expect(mockClient.setHeartbeat).toHaveBeenCalledWith("every 5 minutes", "Report progress"));
    await waitFor(() => expect(screen.getByText("every 5 minutes")).toBeInTheDocument());
    // Inputs are cleared after a successful add.
    expect((screen.getByLabelText("Interval") as HTMLInputElement).value).toBe("");
  });

  it("does not call setHeartbeat when the interval is empty", async () => {
    const user = userEvent.setup();
    render(<HeartbeatsPanel />);
    await user.click(screen.getByRole("button", { name: /set heartbeat/i }));
    expect(mockClient.setHeartbeat).not.toHaveBeenCalled();
  });

  it("adds a heartbeat with a local fallback id when the daemon returns undefined", async () => {
    const user = userEvent.setup();
    (mockClient.setHeartbeat as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    render(<HeartbeatsPanel />);
    await user.type(screen.getByLabelText("Interval"), "10m");
    await user.click(screen.getByRole("button", { name: /set heartbeat/i }));
    await waitFor(() => expect(screen.getByText("10m")).toBeInTheDocument());
    expect(screen.getByText("1 active")).toBeInTheDocument();
  });

  it("removes a heartbeat via removeHeartbeat", async () => {
    const user = userEvent.setup();
    render(<HeartbeatsPanel initial={seeded} />);
    await user.click(screen.getByRole("button", { name: /remove heartbeat/i }));
    await waitFor(() => expect(mockClient.removeHeartbeat).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText(/no heartbeats set/i)).toBeInTheDocument());
  });

  it("surfaces an error when adding fails", async () => {
    const user = userEvent.setup();
    (mockClient.setHeartbeat as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("no active daemon connection"));
    render(<HeartbeatsPanel />);
    await user.type(screen.getByLabelText("Interval"), "10m");
    await user.click(screen.getByRole("button", { name: /set heartbeat/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByText(/no active daemon connection/i)).toBeInTheDocument();
  });
});
