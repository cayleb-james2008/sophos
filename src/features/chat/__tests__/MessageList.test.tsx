// MessageList — scrollable, windowed transcript. Covers the provider-gated
// empty states, starter-prompt filling, rendering message rows with
// retry/edit gating, and honoring a message-focus request from the ⌘K palette.

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MessageList } from "../MessageList";
import { requestMessageFocus } from "../chatBridge";
import type { TranscriptMessage } from "../../../ipc/contract";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const userMsg: TranscriptMessage = {
  id: "u-1",
  role: "user",
  content: "question",
  timestamp: "2026-01-01T12:00:00.000Z",
  status: "complete",
};
const asstMsg: TranscriptMessage = {
  id: "a-1",
  role: "assistant",
  content: "answer",
  timestamp: "2026-01-01T12:01:00.000Z",
  status: "complete",
};

function renderList(props: Partial<Parameters<typeof MessageList>[0]> = {}) {
  const base = {
    messages: [] as TranscriptMessage[],
    busy: false,
    onRetry: vi.fn(),
    onEdit: vi.fn(),
    hasProvider: true,
    onFillPrompt: vi.fn(),
    ...props,
  };
  return { ...render(<MessageList {...base} />), base };
}

describe("MessageList", () => {
  it("shows the empty state with starter prompts when a provider is connected", async () => {
    const user = userEvent.setup();
    const { base } = renderList();
    expect(screen.getByText("Start a conversation")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /starter prompt: help me debug a function/i }));
    expect(base.onFillPrompt).toHaveBeenCalledWith("Help me debug a function");
  });

  it("renders a quiet blank area when no provider is connected", () => {
    renderList({ hasProvider: false });
    expect(screen.queryByText("Start a conversation")).not.toBeInTheDocument();
    expect(document.querySelector(".msglist-blank")).toBeInTheDocument();
  });

  it("renders message rows and enables retry on an assistant with a preceding user", () => {
    renderList({ messages: [userMsg, asstMsg] });
    expect(screen.getByText("question")).toBeInTheDocument();
    expect(screen.getByText("answer")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("does not offer retry while busy", () => {
    renderList({ messages: [userMsg, asstMsg], busy: true });
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });

  it("honors a message-focus request by highlighting the target row", () => {
    renderList({ messages: [userMsg, asstMsg] });
    act(() => {
      requestMessageFocus("a-1");
    });
    const row = document.querySelector('[data-message-id="a-1"]');
    expect(row).toHaveClass("msglist-row--highlight");
  });
});
