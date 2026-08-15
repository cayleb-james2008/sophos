// SchedulesPanel — scheduled (cron) prompts with add/remove via RPC.
// Mocks ipc/client so addSchedule()/removeSchedule() and the connection
// snapshot drive the panel deterministically.

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SchedulesPanel, type ScheduleEntry } from "../SchedulesPanel";

const mockClient = vi.hoisted(() => ({
  addSchedule: vi.fn(),
  removeSchedule: vi.fn(),
}));

const mockConn = vi.hoisted(() => ({
  activeSessionId: "s1",
  schedules: undefined as any,
}));

vi.mock("../../../ipc/client", () => ({
  useIpc: () => mockClient,
  useConnectionState: () => mockConn,
}));

const seeded: ScheduleEntry[] = [
  { id: "sch-1", cron: "0 9 * * 1-5", prompt: "Send the morning standup", active: true },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockConn.activeSessionId = "s1";
  mockConn.schedules = undefined;
  (mockClient.addSchedule as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "sch-new", cron: "0 8 * * *", prompt: "Daily report", active: true });
  (mockClient.removeSchedule as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "sch-1", cron: "0 9 * * 1-5", prompt: "", active: false });
});

describe("SchedulesPanel", () => {
  it("shows the none-scheduled state when empty", () => {
    render(<SchedulesPanel />);
    expect(screen.getByText("none scheduled")).toBeInTheDocument();
    expect(screen.getByText(/add a cron above/i)).toBeInTheDocument();
  });

  it("renders seeded schedules with cron and prompt", () => {
    render(<SchedulesPanel initial={seeded} />);
    expect(screen.getByText("1 scheduled")).toBeInTheDocument();
    expect(screen.getByText("0 9 * * 1-5")).toBeInTheDocument();
    expect(screen.getByText("Send the morning standup")).toBeInTheDocument();
  });

  it("hydrates from the connection snapshot", async () => {
    mockConn.schedules = [{ id: "sch-9", cron: "0 6 * * *", prompt: "Wakeup", active: true }];
    render(<SchedulesPanel />);
    await waitFor(() => expect(screen.getByText("0 6 * * *")).toBeInTheDocument());
    expect(screen.getByText("1 scheduled")).toBeInTheDocument();
  });

  it("adds a schedule via addSchedule", async () => {
    const user = userEvent.setup();
    render(<SchedulesPanel />);
    await user.type(screen.getByLabelText("Cron expression"), "0 8 * * *");
    await user.type(screen.getByLabelText("Prompt"), "Daily report");
    await user.click(screen.getByRole("button", { name: /add schedule/i }));

    await waitFor(() => expect(mockClient.addSchedule).toHaveBeenCalledWith("0 8 * * *", "Daily report"));
    await waitFor(() => expect(screen.getByText("0 8 * * *")).toBeInTheDocument());
    expect((screen.getByLabelText("Cron expression") as HTMLInputElement).value).toBe("");
  });

  it("disables add until both cron and prompt are filled", async () => {
    const user = userEvent.setup();
    render(<SchedulesPanel />);
    const addBtn = screen.getByRole("button", { name: /add schedule/i });
    expect(addBtn).toBeDisabled();

    await user.type(screen.getByLabelText("Cron expression"), "0 8 * * *");
    expect(addBtn).toBeDisabled();
    await user.type(screen.getByLabelText("Prompt"), "Daily report");
    await waitFor(() => expect(addBtn).toBeEnabled());
  });

  it("removes a schedule via removeSchedule", async () => {
    const user = userEvent.setup();
    render(<SchedulesPanel initial={seeded} />);
    await user.click(screen.getByRole("button", { name: /remove schedule/i }));
    await waitFor(() => expect(mockClient.removeSchedule).toHaveBeenCalledWith("sch-1"));
    await waitFor(() => expect(screen.getByText("none scheduled")).toBeInTheDocument());
    expect(screen.queryByText("0 9 * * 1-5")).not.toBeInTheDocument();
  });

  it("surfaces an error when adding fails", async () => {
    const user = userEvent.setup();
    (mockClient.addSchedule as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("schedule down"));
    render(<SchedulesPanel />);
    await user.type(screen.getByLabelText("Cron expression"), "0 8 * * *");
    await user.type(screen.getByLabelText("Prompt"), "Daily report");
    await user.click(screen.getByRole("button", { name: /add schedule/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByText(/schedule down/i)).toBeInTheDocument();
  });
});
