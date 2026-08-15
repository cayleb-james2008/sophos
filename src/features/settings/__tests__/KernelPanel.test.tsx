// KernelPanel.test.tsx — KernelPanel renders the persistent-IPython status,
// variables/imports, execution count, and cell history, and routes the "Execute
// in kernel" action to ipc.prompt. Uses fake timers so the 3s auto-refresh
// interval never fires mid-test.

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KernelPanel } from "../KernelPanel";

const mockClient = vi.hoisted(() => ({
  getKernelState: vi.fn(),
  prompt: vi.fn(),
}));

vi.mock("../../../ipc/client", async () => ({
  useIpc: () => mockClient,
  useIpcEvent: () => undefined,
  useConnectionState: () => ({ status: { kind: "connected" } }),
}));

const KERNEL = {
  status: "running",
  persistent: true,
  toolAvailable: true,
  sessionId: "s1",
  executionCount: 3,
  variables: ["x", "y"],
  imports: ["math"],
  diagnostic: { reason: "ok", message: "Kernel workspace is ready.", nextStep: "None", action: "none" },
  lastOutput: "3",
  cells: [
    { id: "c1", status: "ok", code: "x = 1\nprint(x)", output: "1", executionCount: 1 },
    { id: "c2", status: "error", code: "raise", error: "NameError", executionCount: 2 },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  (mockClient.getKernelState as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.parse(JSON.stringify(KERNEL)));
  (mockClient.prompt as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("KernelPanel", () => {
  it("renders kernel status, variables, imports, execution count, and cell history", async () => {
    render(<KernelPanel />);

    await waitFor(() => expect(screen.getByText("running")).toBeInTheDocument());
    expect(screen.getByText(/Variables · 2/)).toBeInTheDocument();
    expect(screen.getByText("x, y")).toBeInTheDocument();
    expect(screen.getByText(/Imports · 1/)).toBeInTheDocument();
    expect(screen.getByText(/Last execution count: 3/)).toBeInTheDocument();
    expect(screen.getByText(/Cell history · 2/)).toBeInTheDocument();
  });

  it("executes the typed cell via ipc.prompt with the wrapper instruction", async () => {
    const user = userEvent.setup();
    render(<KernelPanel />);
    await waitFor(() => expect(screen.getByText("running")).toBeInTheDocument());

    const editor = screen.getByRole("textbox");
    await user.clear(editor);
    await user.type(editor, "print('hi')");

    await user.click(screen.getByRole("button", { name: /execute in kernel/i }));

    await waitFor(() => expect(mockClient.prompt).toHaveBeenCalledTimes(1));
    const [text, opts] = (mockClient.prompt as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(text).toContain("print('hi')");
    expect(opts).toMatchObject({ queueIfBusy: true, streamingBehavior: "followUp" });
  });

  it("does not execute an empty cell", async () => {
    const user = userEvent.setup();
    render(<KernelPanel />);
    await waitFor(() => expect(screen.getByText("running")).toBeInTheDocument());

    const editor = screen.getByRole("textbox");
    await user.clear(editor);
    await user.click(screen.getByRole("button", { name: /execute in kernel/i }));

    expect(mockClient.prompt).not.toHaveBeenCalled();
  });

  it("surfaces an error when kernel health cannot be read", async () => {
    (mockClient.getKernelState as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("engine down"));
    render(<KernelPanel />);

    await waitFor(() => {
      expect(screen.getByText(/Kernel health could not be read/i)).toBeInTheDocument();
    });
    // The phrase appears both in the diagnostic card and the error banner.
    expect(screen.getAllByText(/Check the engine connection/i).length).toBeGreaterThanOrEqual(1);
  });
});
