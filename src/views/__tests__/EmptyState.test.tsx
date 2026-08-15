// EmptyState.test.tsx — the reusable zero-data placeholder. Renders an icon,
// optional badge, title, description, optional action button, and optional
// footer meta.

import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { EmptyState } from "../EmptyState";

const Icon = () => <svg data-testid="icon" />;

describe("EmptyState", () => {
  it("renders the icon, title, and description", () => {
    render(<EmptyState icon={<Icon />} title="No sessions" description="Start a session to begin." />);
    expect(screen.getByTestId("icon")).toBeInTheDocument();
    expect(screen.getByText("No sessions")).toBeInTheDocument();
    expect(screen.getByText("Start a session to begin.")).toBeInTheDocument();
  });

  it("renders a badge when provided", () => {
    render(<EmptyState icon={<Icon />} title="T" description="d" badge="Module pending" />);
    expect(screen.getByText("Module pending")).toBeInTheDocument();
  });

  it("omits the badge when not provided", () => {
    render(<EmptyState icon={<Icon />} title="T" description="d" />);
    expect(screen.queryByText("Module pending")).not.toBeInTheDocument();
  });

  it("renders an action button that calls onAction", () => {
    const onAction = vi.fn();
    render(<EmptyState icon={<Icon />} title="T" description="d" actionLabel="New session" onAction={onAction} />);
    screen.getByRole("button", { name: "New session" }).click();
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("omits the action button when no label is given", () => {
    render(<EmptyState icon={<Icon />} title="T" description="d" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders the footer meta line when provided", () => {
    render(<EmptyState icon={<Icon />} title="T" description="d" meta="prompt · steer · abort" />);
    expect(screen.getByText("prompt · steer · abort")).toBeInTheDocument();
  });

  it("renders the shell brand prompt glyph", () => {
    render(<EmptyState icon={<Icon />} title="T" description="d" />);
    expect(screen.getByText("sophos")).toBeInTheDocument();
  });
});
