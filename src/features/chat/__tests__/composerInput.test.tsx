// ComposerInput — component tests for the composer-text bridge. These lock in
// the two bar-level fixes: (1) the textarea initializes from the shared ref
// snapshot on mount, so a template inserted from another view lands in the
// composer; and (2) every value write (typing, edit-draft) publishes to the
// ref, so the palette's "save template" always reads the live text.

import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ComposerInput } from "../ComposerInput";
import { getComposerText, setComposerText } from "../composerTextRef";

vi.mock("../../ipc/client", () => ({
  useIpc: () => ({ getSlashCommands: vi.fn().mockResolvedValue([]) }),
}));

const noop = () => {};
const baseProps = {
  busy: false,
  setupReady: true,
  editDraft: null,
  starterDraft: null,
  onSend: noop,
  onAbort: noop,
  onSteer: noop,
  onQueueFollowUp: noop,
  onClearFollowUps: noop,
  onPopFollowUp: () => undefined,
  onSideQuestion: noop,
  onShell: noop,
  onSetName: noop,
};

describe("ComposerInput composer-text bridge", () => {
  beforeEach(() => {
    setComposerText("");
  });

  it("initializes the textarea from the shared ref snapshot on mount", () => {
    // Simulate a template inserted while the composer was unmounted (user on
    // another view): the ref already holds the body before the composer mounts.
    setComposerText("inserted template body");
    render(<ComposerInput {...baseProps} />);
    expect(screen.getByLabelText("Message input")).toHaveValue("inserted template body");
  });

  it("publishes typed text to the shared ref", () => {
    render(<ComposerInput {...baseProps} />);
    const ta = screen.getByLabelText("Message input");
    fireEvent.change(ta, { target: { value: "hello world" } });
    expect(getComposerText()).toBe("hello world");
  });

  it("publishes an edit-draft to the shared ref so save reads it", () => {
    render(<ComposerInput {...baseProps} editDraft={{ index: 0, text: "draft text" }} />);
    expect(getComposerText()).toBe("draft text");
    expect(screen.getByLabelText("Message input")).toHaveValue("draft text");
  });
});
