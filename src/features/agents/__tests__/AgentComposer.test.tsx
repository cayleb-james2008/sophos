// AgentComposer.test.tsx — the send-to-agent relay. Covers canSend gating
// (empty draft / sending), Cmd+Enter submit, the length counter, the
// composition panel (thinking default + skill toggles), and skill loading from
// the runtime catalog with disabled skills filtered.

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentComposer } from "../AgentComposer";
import type { AgentRow } from "../useAgents";

const mockClient = vi.hoisted(() => ({
  getRuntimeInfo: vi.fn(),
  getSettings: vi.fn(),
}));

vi.mock("../../../ipc/client", async () => ({
  useIpc: () => mockClient,
}));

const AGENT: AgentRow = {
  id: "agent-abc123",
  name: "Reviewer",
  kind: "daemon",
  status: "running",
};

function renderComposer({
  agent = AGENT,
  draft = "",
  sending = false,
}: {
  agent?: AgentRow | null;
  draft?: string;
  sending?: boolean;
} = {}) {
  const setDraft = vi.fn();
  const onSend = vi.fn();
  const utils = render(
    <AgentComposer agent={agent} draft={draft} setDraft={setDraft} sending={sending} onSend={onSend} />,
  );
  return { setDraft, onSend, ...utils };
}

beforeEach(() => {
  vi.clearAllMocks();
  (mockClient.getRuntimeInfo as ReturnType<typeof vi.fn>).mockResolvedValue({
    skills: [
      { name: "websearch", description: "Search the web" },
      { name: "code-review", description: "Review code" },
      { name: "release-audit", description: "Audit release" },
    ],
  });
  (mockClient.getSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
    subagentDefaultThinking: "low",
    disabledSkills: ["release-audit"],
  });
});

describe("AgentComposer", () => {
  it("labels the message target with the agent name", () => {
    renderComposer();
    expect(screen.getByText(/MESSAGE TO/)).toBeInTheDocument();
    expect(screen.getByText(/Reviewer/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Message to Reviewer")).toBeInTheDocument();
  });

  it("falls back to AGENT when no agent is selected", () => {
    renderComposer({ agent: null });
    expect(screen.getByLabelText("Message to AGENT")).toBeInTheDocument();
  });

  it("disables Send while the draft is empty", () => {
    renderComposer({ draft: "" });
    expect(screen.getByRole("button", { name: /send/i })).toBeDisabled();
  });

  it("enables Send once the draft has content", () => {
    renderComposer({ draft: "go" });
    expect(screen.getByRole("button", { name: /send/i })).toBeEnabled();
  });

  it("disables Send when whitespace-only", () => {
    renderComposer({ draft: "   " });
    expect(screen.getByRole("button", { name: /send/i })).toBeDisabled();
  });

  it("shows the draft length counter", () => {
    renderComposer({ draft: "hello" });
    expect(screen.getByText("5 / 2000")).toBeInTheDocument();
  });

  it("sends via the Send button", async () => {
    const user = userEvent.setup();
    const { onSend } = renderComposer({ draft: "brief me" });
    await user.click(screen.getByRole("button", { name: /send/i }));
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("sends via Cmd+Enter from the textarea", async () => {
    const user = userEvent.setup();
    const { onSend } = renderComposer({ draft: "brief me" });
    await user.click(screen.getByLabelText("Message to Reviewer"));
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("does not send when the draft is empty even on Cmd+Enter", async () => {
    const user = userEvent.setup();
    const { onSend } = renderComposer({ draft: "" });
    const ta = screen.getByLabelText("Message to Reviewer");
    ta.focus();
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("disables the Send button while sending", () => {
    renderComposer({ draft: "go", sending: true });
    expect(screen.getByRole("button", { name: /send/i })).toBeDisabled();
  });

  it("loads skills from the runtime catalog and filters disabled ones", async () => {
    renderComposer();
    // Open the composition panel to reveal the skills grid.
    await userEvent.click(screen.getByRole("button", { name: /composition/i }));
    await waitFor(() => {
      expect(screen.getByText("websearch")).toBeInTheDocument();
      expect(screen.getByText("code-review")).toBeInTheDocument();
    });
    // The disabled skill is filtered out.
    expect(screen.queryByText("release-audit")).not.toBeInTheDocument();
  });

  it("defaults the thinking level from the subagent policy", async () => {
    renderComposer();
    await userEvent.click(screen.getByRole("button", { name: /composition/i }));
    await waitFor(() => {
      expect(screen.getByLabelText("Thinking level")).toHaveValue("low");
    });
  });

  it("toggles skill selection on and off", async () => {
    const user = userEvent.setup();
    renderComposer();
    await user.click(screen.getByRole("button", { name: /composition/i }));
    await waitFor(() => expect(screen.getByText("websearch")).toBeInTheDocument());

    const box = screen.getByRole("checkbox", { name: /websearch/i });
    await user.click(box);
    expect(box).toBeChecked();
    await user.click(box);
    expect(box).not.toBeChecked();
  });

  it("shows the thinking hint when thinking differs from the default", async () => {
    renderComposer();
    await userEvent.click(screen.getByRole("button", { name: /composition/i }));
    await waitFor(() => expect(screen.getByLabelText("Thinking level")).toBeInTheDocument());
    // Selected from "low" policy to "high" → the hint appears.
    await userEvent.selectOptions(screen.getByLabelText("Thinking level"), "high");
    expect(screen.getByText(/think high/i)).toBeInTheDocument();
  });

  it("shows an empty skills message when none are available", async () => {
    (mockClient.getRuntimeInfo as ReturnType<typeof vi.fn>).mockResolvedValue({ skills: [] });
    renderComposer();
    await userEvent.click(screen.getByRole("button", { name: /composition/i }));
    await waitFor(() => {
      expect(screen.getByText(/No skills available/i)).toBeInTheDocument();
    });
  });
});
