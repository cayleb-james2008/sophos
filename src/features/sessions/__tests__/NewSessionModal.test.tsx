// NewSessionModal.test.tsx — create a fresh session with optional cwd + goal,
// plus "save as default". Mocks the IPC client and the Tauri dialog plugin so
// the create, save-default, and browse flows run deterministically.

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NewSessionModal } from "../NewSessionModal";

type AnyFn = (...args: never[]) => unknown;

const mockClient = vi.hoisted(() => ({
  getSettings: vi.fn(),
  setSettings: vi.fn(),
  newSession: vi.fn(),
} as Record<string, AnyFn>));

vi.mock("../../../ipc/client", async () => ({
  useIpc: () => mockClient,
  useIpcEvent: () => undefined,
  useConnectionState: () => ({ status: { kind: "connected" } }),
  isTauri: true,
}));

const mockDialog = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", async () => ({
  open: mockDialog.open,
}));

function renderModal(open = true) {
  const onClose = vi.fn();
  const onCreated = vi.fn();
  render(<NewSessionModal open={open} onClose={onClose} onCreated={onCreated} />);
  return { onClose, onCreated };
}

beforeEach(() => {
  vi.clearAllMocks();
  (mockClient.getSettings as ReturnType<typeof vi.fn>).mockResolvedValue({ defaultCwd: "C:\\work\\default" });
  (mockClient.setSettings as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (mockClient.newSession as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  mockDialog.open.mockReset();
});

describe("NewSessionModal", () => {
  it("renders nothing when closed", () => {
    renderModal(false);
    expect(screen.queryByLabelText("Working directory")).not.toBeInTheDocument();
    // The settings load must not run while closed.
    expect(mockClient.getSettings).not.toHaveBeenCalled();
  });

  it("pre-fills the saved default working directory on open", async () => {
    renderModal();
    await waitFor(() => expect(mockClient.getSettings).toHaveBeenCalled());
    expect(screen.getByDisplayValue("C:\\work\\default")).toBeInTheDocument();
  });

  it("creates a session with trimmed cwd and goal", async () => {
    const { onClose, onCreated } = renderModal();
    await waitFor(() => expect(screen.getByLabelText("Working directory")).toBeInTheDocument());

    await userEvent.clear(screen.getByLabelText("Working directory"));
    await userEvent.type(screen.getByLabelText("Working directory"), "  C:\\work\\project  ");
    await userEvent.type(screen.getByLabelText("Goal"), "  Ship the release  ");

    await userEvent.click(screen.getByRole("button", { name: /create session/i }));
    await waitFor(() => expect(mockClient.newSession).toHaveBeenCalledWith("C:\\work\\project", "Ship the release"));
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("passes undefined cwd/goal when the fields are blank", async () => {
    renderModal();
    await waitFor(() => expect(screen.getByRole("button", { name: /create session/i })).toBeInTheDocument());

    // The saved default is present — clear it so cwd is empty.
    await userEvent.clear(screen.getByLabelText("Working directory"));
    await userEvent.click(screen.getByRole("button", { name: /create session/i }));
    await waitFor(() => expect(mockClient.newSession).toHaveBeenCalledWith(undefined, undefined));
  });

  it("persists the working directory as default when the checkbox is checked", async () => {
    renderModal();
    await waitFor(() => expect(screen.getByRole("checkbox")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: /create session/i }));

    await waitFor(() => expect(mockClient.setSettings).toHaveBeenCalled());
    const call = (mockClient.setSettings as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.defaultCwd).toBe("C:\\work\\default");
  });

  it("clears the fields after a successful create", async () => {
    renderModal();
    await waitFor(() => expect(screen.getByLabelText("Working directory")).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText("Goal"), "Build the thing");
    await userEvent.click(screen.getByRole("button", { name: /create session/i }));
    await waitFor(() => expect(screen.getByLabelText("Goal")).toHaveValue(""));
  });

  it("uses the folder picker to set the working directory", async () => {
    mockDialog.open.mockResolvedValue("C:\\picked\\folder");
    renderModal();
    await waitFor(() => expect(screen.getByRole("button", { name: /browse/i })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /browse/i }));
    await waitFor(() => expect(screen.getByDisplayValue("C:\\picked\\folder")).toBeInTheDocument());
    expect(screen.queryByText(/Folder picker unavailable/)).not.toBeInTheDocument();
  });

  it("shows a hint when the folder picker returns nothing", async () => {
    mockDialog.open.mockResolvedValue(null);
    renderModal();
    await waitFor(() => expect(screen.getByRole("button", { name: /browse/i })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /browse/i }));
    await waitFor(() => expect(screen.getByText(/Folder picker unavailable/)).toBeInTheDocument());
  });

  it("disables the create button while the create call is in flight", async () => {
    // The component's create() has no catch for a failing IPC call (it relies
    // on the finally to reset busy), so exercise the in-flight guard instead
    // of forcing an unhandled rejection.
    (mockClient.newSession as ReturnType<typeof vi.fn>).mockImplementation(() => new Promise(() => {}));
    const { onClose, onCreated } = renderModal();
    await waitFor(() => expect(screen.getByRole("button", { name: /create session/i })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /create session/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /create session/i })).toBeDisabled());
    expect(mockClient.newSession).toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
