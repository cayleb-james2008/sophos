// ComposerInput — the prompt input box with TUI-parity key handling. Covers
// send/steer routing by busy state, Alt+Enter follow-ups, Alt+Up retrieval,
// Escape behavior, shell / side-question / name prefixes, slash autocomplete
// navigation + insertion, and the /cd directory-picker flow.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ComposerInput } from "../ComposerInput";

const mockIpc = vi.hoisted(() => ({
  getSlashCommands: vi.fn(),
  runCommand: vi.fn().mockResolvedValue(undefined),
}));

const mockDialog = vi.hoisted(() => ({ open: vi.fn() }));

vi.mock("../../../ipc/client", () => ({
  useIpc: () => mockIpc,
  useIpcEvent: () => {},
  useConnectionState: () => ({}),
  isTauri: false,
}));

vi.mock("@tauri-apps/plugin-dialog", () => mockDialog);

const baseProps = () => ({
  busy: false,
  setupReady: true,
  editDraft: null as { index: number; text: string } | null,
  starterDraft: null as { seq: number; text: string } | null,
  onSend: vi.fn(),
  onAbort: vi.fn(),
  onSteer: vi.fn(),
  onQueueFollowUp: vi.fn(),
  onClearFollowUps: vi.fn(),
  onPopFollowUp: vi.fn(),
  onSideQuestion: vi.fn(),
  onShell: vi.fn(),
  onSetName: vi.fn(),
});

function renderInput(props: ReturnType<typeof baseProps>) {
  render(<ComposerInput {...props} />);
  return screen.getByLabelText("Message input");
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIpc.getSlashCommands.mockResolvedValue([
    { name: "compact", description: "Compact the session context", source: "builtin" },
    { name: "refine", description: "Refine the session goal", source: "builtin" },
  ]);
  mockDialog.open.mockReset();
});

describe("ComposerInput send/steer routing", () => {
  it("sends the trimmed text on Enter and clears the box", async () => {
    const user = userEvent.setup();
    const props = baseProps();
    const ta = renderInput(props);
    await user.type(ta, "  hello  ");
    await user.keyboard("{Enter}");
    expect(props.onSend).toHaveBeenCalledWith("hello");
    expect(ta).toHaveValue("");
  });

  it("steers instead of sending while busy", async () => {
    const user = userEvent.setup();
    const props = baseProps();
    props.busy = true;
    const ta = renderInput(props);
    await user.type(ta, "go on");
    await user.keyboard("{Enter}");
    expect(props.onSteer).toHaveBeenCalledWith("go on");
    expect(props.onSend).not.toHaveBeenCalled();
  });

  it("does not send when setup is not ready", async () => {
    const user = userEvent.setup();
    const props = baseProps();
    props.setupReady = false;
    const ta = renderInput(props);
    await user.type(ta, "hello");
    await user.keyboard("{Enter}");
    expect(props.onSend).not.toHaveBeenCalled();
  });

  it("does not send empty text", async () => {
    const user = userEvent.setup();
    const props = baseProps();
    const ta = renderInput(props);
    await user.type(ta, "   ");
    await user.keyboard("{Enter}");
    expect(props.onSend).not.toHaveBeenCalled();
  });

  it("queues a follow-up with Alt+Enter and clears the box", async () => {
    const user = userEvent.setup();
    const props = baseProps();
    const ta = renderInput(props);
    await user.type(ta, "later");
    await user.keyboard("{Alt>}{Enter}{/Alt}");
    expect(props.onQueueFollowUp).toHaveBeenCalledWith("later");
    expect(ta).toHaveValue("");
  });

  it("retrieves a follow-up with Alt+Up and fills the editor", async () => {
    const user = userEvent.setup();
    const props = baseProps();
    props.onPopFollowUp.mockReturnValue("retrieved");
    const ta = renderInput(props);
    await user.click(ta); // focus the textarea so the keyboard event lands on it
    await user.keyboard("{Alt>}{ArrowUp}{/Alt}");
    expect(props.onPopFollowUp).toHaveBeenCalled();
    expect(ta).toHaveValue("retrieved");
  });
});

describe("ComposerInput Escape and abort", () => {
  it("clears the box on Escape while idle", async () => {
    const user = userEvent.setup();
    const props = baseProps();
    const ta = renderInput(props);
    await user.type(ta, "some text");
    await user.keyboard("{Escape}");
    expect(ta).toHaveValue("");
    expect(props.onClearFollowUps).not.toHaveBeenCalled();
  });

  it("clears queued follow-ups on Escape while busy", async () => {
    const user = userEvent.setup();
    const props = baseProps();
    props.busy = true;
    renderInput(props);
    await user.type(screen.getByLabelText("Message input"), "x");
    await user.keyboard("{Escape}");
    expect(props.onClearFollowUps).toHaveBeenCalled();
  });

  it("calls onAbort via the stop button while busy", async () => {
    const user = userEvent.setup();
    const props = baseProps();
    props.busy = true;
    renderInput(props);
    await user.click(screen.getByRole("button", { name: /stop generating/i }));
    expect(props.onAbort).toHaveBeenCalled();
  });
});

describe("ComposerInput shell / side / name prefixes", () => {
  it("routes a visible shell command with !", async () => {
    const user = userEvent.setup();
    const props = baseProps();
    const ta = renderInput(props);
    await user.type(ta, "!ls -la");
    await user.keyboard("{Enter}");
    expect(props.onShell).toHaveBeenCalledWith("ls -la", false);
  });

  it("routes a hidden shell command with !!", async () => {
    const user = userEvent.setup();
    const props = baseProps();
    const ta = renderInput(props);
    await user.type(ta, "!!secret");
    await user.keyboard("{Enter}");
    expect(props.onShell).toHaveBeenCalledWith("secret", true);
  });

  it("routes /btw and /side side questions", async () => {
    const user = userEvent.setup();
    const props = baseProps();
    const ta = renderInput(props);
    await user.type(ta, "/btw what is this?");
    await user.keyboard("{Enter}");
    expect(props.onSideQuestion).toHaveBeenCalledWith("btw", "what is this?");

    const ta2 = screen.getByLabelText("Message input");
    await user.type(ta2, "/side second q");
    await user.keyboard("{Enter}");
    expect(props.onSideQuestion).toHaveBeenCalledWith("side", "second q");
  });

  it("routes a session name via /name", async () => {
    const user = userEvent.setup();
    const props = baseProps();
    const ta = renderInput(props);
    await user.type(ta, "/name My Session");
    await user.keyboard("{Enter}");
    expect(props.onSetName).toHaveBeenCalledWith("My Session");
  });
});

describe("ComposerInput slash autocomplete", () => {
  it("shows matching commands when the value starts with /", async () => {
    const user = userEvent.setup();
    const props = baseProps();
    const ta = renderInput(props);
    await user.type(ta, "/co");
    expect(screen.getByRole("listbox", { name: /slash commands/i })).toBeInTheDocument();
  });

  it("inserts the selected command on Enter", async () => {
    const user = userEvent.setup();
    const props = baseProps();
    const ta = renderInput(props);
    await user.type(ta, "/co");
    await user.keyboard("{Enter}");
    expect(ta).toHaveValue("/compact ");
  });

  it("navigates the selected option with arrow keys", async () => {
    const user = userEvent.setup();
    const props = baseProps();
    const ta = renderInput(props);
    await user.type(ta, "/");
    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowDown}");
    expect(options[1]).toHaveAttribute("aria-selected", "true");
  });
});

describe("ComposerInput /cd flow", () => {
  it("opens the directory picker and calls runCommand with the picked path", async () => {
    const user = userEvent.setup();
    const props = baseProps();
    mockDialog.open.mockResolvedValue("C:\\work\\project");
    const ta = renderInput(props);
    await user.type(ta, "/cd");
    await user.keyboard("{Enter}");
    expect(mockDialog.open).toHaveBeenCalledWith({ directory: true });
    expect(mockIpc.runCommand).toHaveBeenCalledWith("cd", ["C:\\work\\project"]);
    expect(ta).toHaveValue("");
    expect(screen.getByRole("status")).toHaveTextContent(/Working directory changed/i);
  });

  it("does not send /cd as a prompt when the picker is cancelled", async () => {
    const user = userEvent.setup();
    const props = baseProps();
    mockDialog.open.mockResolvedValue(null);
    const ta = renderInput(props);
    await user.type(ta, "/cd");
    await user.keyboard("{Enter}");
    expect(mockIpc.runCommand).not.toHaveBeenCalled();
    expect(props.onSend).not.toHaveBeenCalled();
    expect(ta).toHaveValue("");
  });
});
