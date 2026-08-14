// MessageActions — fork button tests. The Fork action must render on assistant
// messages only, and only when both onFork is provided and canFork is true
// (non-streaming assistant). It must never appear for user / system / tool.

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MessageActions } from "../MessageActions";

describe("MessageActions fork", () => {
  it("renders a Fork button on assistant when onFork is provided and canFork is true", () => {
    render(<MessageActions role="assistant" content="hi" onFork={vi.fn()} canFork />);
    expect(screen.getByTitle("Fork from here")).toBeTruthy();
  });

  it("does not render a Fork button for user messages", () => {
    render(<MessageActions role="user" content="hi" onFork={vi.fn()} canFork />);
    expect(screen.queryByTitle("Fork from here")).toBeNull();
  });

  it("does not render a Fork button for system messages", () => {
    render(<MessageActions role="system" content="hi" onFork={vi.fn()} canFork />);
    expect(screen.queryByTitle("Fork from here")).toBeNull();
  });

  it("does not render a Fork button for tool messages", () => {
    render(<MessageActions role="tool" content="hi" onFork={vi.fn()} canFork />);
    expect(screen.queryByTitle("Fork from here")).toBeNull();
  });

  it("does not render a Fork button when canFork is false (e.g. streaming)", () => {
    render(<MessageActions role="assistant" content="hi" onFork={vi.fn()} canFork={false} />);
    expect(screen.queryByTitle("Fork from here")).toBeNull();
  });

  it("does not render a Fork button when onFork is not provided", () => {
    render(<MessageActions role="assistant" content="hi" canFork />);
    expect(screen.queryByTitle("Fork from here")).toBeNull();
  });

  it("calls onFork when the Fork button is clicked", () => {
    const onFork = vi.fn();
    render(<MessageActions role="assistant" content="hi" onFork={onFork} canFork />);
    fireEvent.click(screen.getByTitle("Fork from here"));
    expect(onFork).toHaveBeenCalledTimes(1);
  });
});
