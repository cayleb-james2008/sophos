import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HarnessStatePanel } from "../HarnessStatePanel";

const mockClient = vi.hoisted(() => ({
  getHarnessState: vi.fn(),
  getMemoryState: vi.fn(),
  getTokenBudget: vi.fn(),
  compactContext: vi.fn(),
  prompt: vi.fn(),
}));

vi.mock("../../../ipc/client", () => ({
  useIpc: () => mockClient,
  isDemoMode: () => false,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockClient.getHarnessState.mockResolvedValue({ source: "daemon", entries: [], refinements: [] });
  mockClient.getMemoryState.mockResolvedValue({ working: [], recall: [], archival: [], totalCount: 0 });
  mockClient.getTokenBudget.mockResolvedValue({ totalTokens: 1234, contextLimit: 8192, usagePercent: 15.1 });
  mockClient.compactContext.mockResolvedValue({ beforeTokens: 1234, afterTokens: null, savedTokens: null });
});

describe("HarnessStatePanel native token budget", () => {
  it("shows measured totals without invented tiers and waits for the next response after summarizing", async () => {
    const user = userEvent.setup();
    render(<HarnessStatePanel />);

    expect(screen.queryByRole("button", { name: /semantic memory tiers/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /token budget & compaction/i }));
    const panel = await screen.findByTestId("token-budget-panel");
    expect(within(panel).getByText(/1,234 \/ 8,192 tokens/)).toBeInTheDocument();
    expect(within(panel).getByText("15.1% Used")).toBeInTheDocument();
    expect(within(panel).queryByText("Chat Transcript")).not.toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: "Prune Oldest Turns" })).not.toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: "Evict Dormant Tools" })).not.toBeInTheDocument();

    await user.click(within(panel).getByRole("button", { name: "Summarize Context" }));
    expect(
      await within(panel).findByText(
        "Context summarized. Token usage updates after the next model response.",
      ),
    ).toBeInTheDocument();
    expect(within(panel).queryByText(/tokens reclaimed/i)).not.toBeInTheDocument();
    expect(mockClient.compactContext).toHaveBeenCalledWith("semantic-summarize");
  });

  it("renders a daemon compaction failure as a visible notice", async () => {
    const user = userEvent.setup();
    mockClient.compactContext.mockRejectedValue(new Error("Daemon compaction unavailable"));
    render(<HarnessStatePanel />);

    await user.click(screen.getByRole("button", { name: /token budget & compaction/i }));
    const panel = await screen.findByTestId("token-budget-panel");
    await user.click(within(panel).getByRole("button", { name: "Summarize Context" }));

    expect(await within(panel).findByText("Daemon compaction unavailable")).toBeInTheDocument();
  });
});
