// Sidebar.test.tsx — the quiet navigation rail. Renders every nav item,
// marks the active view, calls onNavigate, and surfaces the Inbox unread
// badge when present.

import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "../Sidebar";

const unreadMock = vi.hoisted(() => ({ useUnreadBadge: vi.fn(() => 0) }));
vi.mock("../../ipc/unread", () => unreadMock);

const NAV_LABELS = ["Chat", "Sessions", "Agents", "Inbox", "Settings"];

beforeEach(() => {
  unreadMock.useUnreadBadge.mockReturnValue(0);
});

describe("Sidebar", () => {
  it("renders every navigation item", () => {
    render(<Sidebar active="chat" onNavigate={() => {}} />);
    for (const label of NAV_LABELS) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("marks the active view with aria-current and clicks navigate", () => {
    const onNavigate = vi.fn();
    render(<Sidebar active="sessions" onNavigate={onNavigate} />);

    const active = screen.getByRole("button", { name: "Sessions" });
    expect(active).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Chat" })).not.toHaveAttribute("aria-current");

    screen.getByRole("button", { name: "Settings" }).click();
    expect(onNavigate).toHaveBeenCalledWith("settings");
  });

  it("renders the brand and command hint", () => {
    render(<Sidebar active="chat" onNavigate={() => {}} />);
    expect(screen.getByText("SOPHOS")).toBeInTheDocument();
    // The sidebar version literal tracks the current release (v0.7).
    expect(screen.getByText("v0.7.2-beta")).toBeInTheDocument();
    expect(screen.getByText("Command")).toBeInTheDocument();
    expect(screen.getByText("⌘K")).toBeInTheDocument();
  });

  it("shows the inbox unread badge when the count is non-zero", () => {
    unreadMock.useUnreadBadge.mockReturnValue(3);
    render(<Sidebar active="chat" onNavigate={() => {}} />);
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("hides the inbox badge when the count is zero", () => {
    render(<Sidebar active="chat" onNavigate={() => {}} />);
    expect(screen.queryByText("3")).not.toBeInTheDocument();
  });
});
