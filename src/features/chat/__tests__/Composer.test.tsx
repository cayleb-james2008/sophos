// Composer — the thin orchestrator that composes ComposerInput with the
// follow-up queue, inline side-question panels, and steer/shell notices.
// Verifies prop wiring through to each sub-piece.

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Composer } from "../Composer";
import type { FollowUp, SideQuestion } from "../useChat";

const mockIpc = vi.hoisted(() => ({
  getSlashCommands: vi.fn().mockResolvedValue([]),
  runCommand: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../ipc/client", () => ({
  useIpc: () => mockIpc,
  useIpcEvent: () => {},
  useConnectionState: () => ({}),
  isTauri: false,
}));

const followUps: FollowUp[] = [{ id: 1, text: "pending" }];
const sideQuestion: SideQuestion = {
  id: "sq-1",
  kind: "btw",
  question: "inline?",
  status: "complete",
  answer: "yes",
};

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
  followUps: [] as FollowUp[],
  steered: null as { text: string; at: number } | null,
  shellNotice: null as { command: string; hidden: boolean } | null,
  onSideQuestion: vi.fn(),
  sideQuestions: [] as SideQuestion[],
  onDismissSideQuestion: vi.fn(),
  onShell: vi.fn(),
  onSetName: vi.fn(),
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Composer", () => {
  it("renders the input and ready footer hint", () => {
    render(<Composer {...baseProps()} />);
    expect(screen.getByLabelText("Message input")).toBeInTheDocument();
    expect(screen.getByText("ready")).toBeInTheDocument();
    expect(screen.getByText(/follow-up/)).toBeInTheDocument();
  });

  it("shows streaming… while busy", () => {
    const props = baseProps();
    props.busy = true;
    render(<Composer {...props} />);
    expect(screen.getByText("streaming…")).toBeInTheDocument();
  });

  it("renders queued follow-up chips", () => {
    const props = baseProps();
    props.followUps = followUps;
    render(<Composer {...props} />);
    expect(screen.getByText("pending")).toBeInTheDocument();
  });

  it("renders inline side-question panels", () => {
    const props = baseProps();
    props.sideQuestions = [sideQuestion];
    render(<Composer {...props} />);
    expect(screen.getByText("inline?")).toBeInTheDocument();
  });

  it("renders the steered and shell notices", () => {
    const props = baseProps();
    props.steered = { text: "keep going", at: Date.now() };
    props.shellNotice = { command: "npm test", hidden: false };
    render(<Composer {...props} />);
    expect(screen.getByText("“keep going”")).toBeInTheDocument();
    expect(screen.getByText("$ npm test")).toBeInTheDocument();
  });
});
