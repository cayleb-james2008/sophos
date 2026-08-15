// MessageActions — hover-revealed per-role action toolbar. Covers copy (via the
// clipboard API), edit-and-resend for user messages, retry for assistant
// messages, and the copy-only roles (system / tool).

import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MessageActions } from "../MessageActions";

const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, "clipboard", {
    value: clipboard,
    configurable: true,
  });
});

describe("MessageActions", () => {
  it("copies the message content", () => {
    render(<MessageActions role="assistant" content="hello world" />);
    fireEvent.click(screen.getByRole("button", { name: /copy message/i }));
    expect(clipboard.writeText).toHaveBeenCalledWith("hello world");
  });

  it("shows edit-and-resend for user messages when canEdit", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    render(<MessageActions role="user" content="msg" onEdit={onEdit} canEdit />);
    await user.click(screen.getByRole("button", { name: /edit and resend/i }));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("hides the edit button when canEdit is false", () => {
    render(<MessageActions role="user" content="msg" onEdit={vi.fn()} canEdit={false} />);
    expect(screen.queryByRole("button", { name: /edit and resend/i })).not.toBeInTheDocument();
  });

  it("shows retry for assistant messages when canRetry", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<MessageActions role="assistant" content="msg" onRetry={onRetry} canRetry />);
    await user.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("hides retry for assistant messages when canRetry is false", () => {
    render(<MessageActions role="assistant" content="msg" onRetry={vi.fn()} canRetry={false} />);
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });

  it("only offers copy for system and tool messages", () => {
    render(<MessageActions role="system" content="sys" />);
    expect(screen.getByRole("button", { name: /copy message/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit and resend/i })).not.toBeInTheDocument();
  });
});
