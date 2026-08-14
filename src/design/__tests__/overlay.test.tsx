import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { Card, Modal, Tabs, Tooltip, ScrollArea, ErrorBoundary } from "@/design";

describe("Card", () => {
  it("renders children", () => {
    render(<Card>Content</Card>);
    expect(screen.getByText("Content")).toBeInTheDocument();
  });

  const variants = ["default", "raised", "interactive", "accent"] as const;
  it.each(variants)("renders the %s variant", (variant) => {
    render(<Card variant={variant}>Card</Card>);
    expect(screen.getByText("Card")).toBeInTheDocument();
  });
});

describe("Modal", () => {
  it("renders nothing when closed", () => {
    const onClose = vi.fn();
    render(
      <Modal open={false} onClose={onClose}>
        Hidden
      </Modal>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders title, children, and footer when open", () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Settings" footer={<button>Save</button>}>
        Body
      </Modal>,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.getByText("Body")).toBeInTheDocument();
    expect(screen.getByText("Save")).toBeInTheDocument();
  });

  it("calls onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Settings">
        Body
      </Modal>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose on Escape", () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose}>
        Body
      </Modal>,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("Tabs", () => {
  const items = [
    { id: "a", label: "Tab A" },
    { id: "b", label: "Tab B" },
    { id: "c", label: "Tab C", disabled: true },
  ];

  it("renders items and marks the active tab", () => {
    render(<Tabs items={items} activeId="a" onChange={() => {}} />);
    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(3);
    expect(screen.getByRole("tab", { name: "Tab A" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Tab B" })).toHaveAttribute("aria-selected", "false");
  });

  it("calls onChange with the clicked tab id", () => {
    const onChange = vi.fn();
    render(<Tabs items={items} activeId="a" onChange={onChange} />);
    fireEvent.click(screen.getByRole("tab", { name: "Tab B" }));
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("disables disabled tabs", () => {
    render(<Tabs items={items} activeId="a" onChange={() => {}} />);
    expect(screen.getByRole("tab", { name: "Tab C" })).toBeDisabled();
  });
});

describe("Tooltip", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows content on hover and hides on leave", () => {
    vi.useFakeTimers();
    render(
      <Tooltip content="Tip text">
        <button>Hover</button>
      </Tooltip>,
    );
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    fireEvent.mouseEnter(screen.getByRole("button", { name: "Hover" }));
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByRole("tooltip")).toHaveTextContent("Tip text");

    fireEvent.mouseLeave(screen.getByRole("button", { name: "Hover" }));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});

describe("ScrollArea", () => {
  it("renders children", () => {
    render(
      <ScrollArea>
        <p>Scroll content</p>
      </ScrollArea>,
    );
    expect(screen.getByText("Scroll content")).toBeInTheDocument();
  });
});

describe("ErrorBoundary", () => {
  const Bomb = () => {
    throw new Error("boom");
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("catches a throwing child and renders the fallback", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary label="View">
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("boom")).toBeInTheDocument();
    expect(screen.getByText("View")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
    spy.mockRestore();
  });

  it("renders a custom label in the fallback", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary label="Custom Label">
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Custom Label")).toBeInTheDocument();
    spy.mockRestore();
  });

  it("replaces all children with the fallback when one child throws", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary label="View">
        <div>Good child</div>
        <Bomb />
        <div>Another good child</div>
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("Good child")).not.toBeInTheDocument();
    expect(screen.queryByText("Another good child")).not.toBeInTheDocument();
    spy.mockRestore();
  });

  it("lets an outer boundary catch a failure in the inner boundary's fallback", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    // A component rendered as the inner boundary's label throws when the
    // inner fallback renders it. That throw happens inside the inner
    // boundary's own render, which a boundary does not catch — so the outer
    // boundary must catch it.
    const ThrowingLabel = () => {
      throw new Error("fallback boom");
    };
    render(
      <ErrorBoundary label="Outer">
        <ErrorBoundary label={<ThrowingLabel /> as unknown as string}>
          <Bomb />
        </ErrorBoundary>
      </ErrorBoundary>,
    );
    // The inner boundary catches Bomb and renders its fallback, but that
    // fallback throws, so the outer boundary renders its own fallback.
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Outer")).toBeInTheDocument();
    // The inner boundary's default fallback text must not be present.
    expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();
    spy.mockRestore();
  });

  it("recovers when the error clears and reload is mocked", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const reloadSpy = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { reload: reloadSpy },
    });

    const { rerender } = render(
      <ErrorBoundary label="View">
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();

    // Rerender with a non-throwing child. The boundary is still in its error
    // state, so it keeps showing the fallback until the state is reset.
    rerender(
      <ErrorBoundary label="View">
        <div>Recovered</div>
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();

    // Clicking Reload resets the error state and calls reload.
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    // After the state reset the boundary renders its children again.
    expect(screen.getByText("Recovered")).toBeInTheDocument();

    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
    spy.mockRestore();
  });
});
