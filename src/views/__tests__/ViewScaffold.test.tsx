// ViewScaffold.test.tsx — the shared routed-view layout. It renders the header
// (index / title / description) and a body that swaps between children, a
// loading state, or an error state with Retry. Children are wrapped in an
// ErrorBoundary so a crash in one view can't take down the app.

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ViewScaffold } from "../ViewScaffold";

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe("ViewScaffold", () => {
  it("renders the index, title, and description header", () => {
    render(
      <ViewScaffold index="Agents" title="Agents" description="Attached agents">
        <p>body</p>
      </ViewScaffold>,
    );
    expect(screen.getByRole("heading", { name: "Agents" })).toBeInTheDocument();
    expect(screen.getByText("Attached agents")).toBeInTheDocument();
    // The index eyebrow duplicates the title text.
    expect(screen.getAllByText("Agents").length).toBeGreaterThanOrEqual(2);
  });

  it("renders children by default", () => {
    render(
      <ViewScaffold index="Chat" title="Chat" description="desc">
        <p>child content</p>
      </ViewScaffold>,
    );
    expect(screen.getByText("child content")).toBeInTheDocument();
  });

  it("renders a loading state in place of children when loading", () => {
    render(
      <ViewScaffold index="X" title="X" description="d" loading>
        <p>child content</p>
      </ViewScaffold>,
    );
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(screen.queryByText("child content")).not.toBeInTheDocument();
  });

  it("renders an error state with detail and a working Retry button", () => {
    const onRetry = vi.fn();
    render(
      <ViewScaffold index="Agents" title="Agents" description="d" error="boom" onRetry={onRetry}>
        <p>child content</p>
      </ViewScaffold>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/Agents failed to load/i)).toBeInTheDocument();
    expect(screen.getByText("boom")).toBeInTheDocument();
    screen.getByRole("button", { name: "Retry" }).click();
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("child content")).not.toBeInTheDocument();
  });

  it("omits the Retry button when onRetry is not provided", () => {
    render(
      <ViewScaffold index="X" title="X" description="d" error="nope">
        <p>child</p>
      </ViewScaffold>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("gives error precedence over loading", () => {
    render(
      <ViewScaffold index="X" title="X" description="d" error="bad" loading>
        <p>child</p>
      </ViewScaffold>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Loading" })).not.toBeInTheDocument();
  });

  it("lets the inner ErrorBoundary catch a crashing child", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const Bomb = () => {
      throw new Error("child blew up");
    };
    render(
      <ViewScaffold index="View" title="View" description="d">
        <Bomb />
      </ViewScaffold>,
    );
    // The ErrorBoundary fallback renders asynchronously under React 18 —
    // use waitFor so the assertions don't race the commit phase under heavy
    // parallel load (the original getAllByText("View") flake).
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "View" })).toBeInTheDocument();
    expect(screen.getByText("child blew up")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
    spy.mockRestore();
  });
});
