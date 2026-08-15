import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import React from "react";
import {
  Text,
  Button,
  Input,
  TextArea,
  Select,
  Kbd,
  Badge,
  StatusDot,
  IconButton,
  Skeleton,
  Spinner,
} from "@/design";

describe("Text", () => {
  it("renders children", () => {
    render(<Text>Hello</Text>);
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  it("renders as a heading when `as` is set", () => {
    render(<Text as="h2">Heading</Text>);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Heading");
  });
});

describe("Button", () => {
  const variants = ["primary", "outline", "ghost", "danger", "accent-soft"] as const;

  it.each(variants)("renders a button for the %s variant", (variant) => {
    render(<Button variant={variant}>Action</Button>);
    expect(screen.getByRole("button", { name: "Action" })).toBeInTheDocument();
  });

  it("handles onClick", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Click</Button>);
    fireEvent.click(screen.getByRole("button", { name: "Click" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders a loading spinner and disables while loading", () => {
    render(<Button loading>Save</Button>);
    expect(screen.getByRole("button")).toBeDisabled();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("is disabled when `disabled` is set", () => {
    render(<Button disabled>No</Button>);
    expect(screen.getByRole("button", { name: "No" })).toBeDisabled();
  });
});

describe("Input", () => {
  it("renders a labelled input and links the label via htmlFor", () => {
    render(<Input label="API Key" placeholder="sk-..." />);
    expect(screen.getByLabelText("API Key")).toBeInTheDocument();
    expect(screen.getByLabelText("API Key")).toHaveAttribute("id", "pa-input-api-key");
  });

  it("renders prefix and suffix", () => {
    render(<Input prefix={<span>Pfx</span>} suffix={<span>Sfx</span>} />);
    expect(screen.getByText("Pfx")).toBeInTheDocument();
    expect(screen.getByText("Sfx")).toBeInTheDocument();
  });

  it("shows the error state and message", () => {
    render(<Input error="Required" />);
    expect(screen.getByText("Required")).toBeInTheDocument();
  });

  it("forwards standard input attributes (value/onChange)", () => {
    const onChange = vi.fn();
    render(<Input defaultValue="hello" onChange={onChange} aria-label="Name" />);
    expect(screen.getByDisplayValue("hello")).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue("hello"), { target: { value: "hi" } });
    expect(onChange).toHaveBeenCalled();
  });

  it("forwards a ref to the native input element", () => {
    const ref = React.createRef<HTMLInputElement>();
    render(<Input ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });

  it("forwards a ref alongside other props and reflects the value", () => {
    const ref = React.createRef<HTMLInputElement>();
    render(<Input ref={ref} label="Test" value="hello" onChange={() => {}} />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
    expect(ref.current?.value).toBe("hello");
  });
});

describe("TextArea", () => {
  it("renders a labelled textarea", () => {
    render(<TextArea label="Notes" />);
    expect(screen.getByLabelText("Notes")).toBeInTheDocument();
  });

  it("shows the error state and message", () => {
    render(<TextArea error="Too long" />);
    expect(screen.getByText("Too long")).toBeInTheDocument();
  });

  it("forwards a ref to the native textarea element", () => {
    const ref = React.createRef<HTMLTextAreaElement>();
    render(<TextArea ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLTextAreaElement);
  });
});

describe("Select", () => {
  const options = [
    { value: "a", label: "Option A" },
    { value: "b", label: "Option B" },
  ];

  it("renders a combobox with its options", () => {
    render(<Select options={options} />);
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getByText("Option A")).toBeInTheDocument();
    expect(screen.getByText("Option B")).toBeInTheDocument();
  });

  it("renders a placeholder option when provided", () => {
    render(<Select options={options} placeholder="Pick one" />);
    expect(screen.getByText("Pick one")).toBeInTheDocument();
  });

  it("forwards a ref to the native select element", () => {
    const ref = React.createRef<HTMLSelectElement>();
    render(<Select ref={ref} options={options} />);
    expect(ref.current).toBeInstanceOf(HTMLSelectElement);
  });
});

describe("Kbd", () => {
  it("renders children inside a <kbd> element", () => {
    const { container } = render(<Kbd>Ctrl+K</Kbd>);
    const kbd = container.querySelector("kbd");
    expect(kbd).toBeInTheDocument();
    expect(kbd).toHaveTextContent("Ctrl+K");
  });
});

describe("Badge", () => {
  const tones = ["neutral", "accent", "success", "warning", "danger", "info"] as const;

  it.each(tones)("renders a %s badge", (tone) => {
    render(<Badge tone={tone}>Label</Badge>);
    expect(screen.getByText("Label")).toBeInTheDocument();
  });

  it("renders a status dot span when `dot` is enabled", () => {
    const { container } = render(<Badge dot>Live</Badge>);
    expect(screen.getByText("Live")).toBeInTheDocument();
    // outer badge span + the dot span
    expect(container.querySelectorAll("span").length).toBeGreaterThanOrEqual(2);
  });
});

describe("StatusDot", () => {
  const states = ["connecting", "connected", "disconnected", "reconnecting", "idle"] as const;
  const labels: Record<(typeof states)[number], string> = {
    connecting: "Connecting",
    connected: "Connected",
    disconnected: "Disconnected",
    reconnecting: "Reconnecting",
    idle: "Idle",
  };

  it.each(states)("renders a status for %s with the right aria-label", (state) => {
    render(<StatusDot state={state} />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", labels[state]);
  });

  it("accepts a custom label", () => {
    render(<StatusDot label="Custom" />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", "Custom");
  });
});

describe("IconButton", () => {
  it("renders with an accessible label from title", () => {
    render(<IconButton title="Delete">✕</IconButton>);
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("handles onClick", () => {
    const onClick = vi.fn();
    render(
      <IconButton title="Delete" onClick={onClick}>
        ✕
      </IconButton>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("Skeleton", () => {
  it("renders a hidden placeholder with the given dimensions", () => {
    const { container } = render(<Skeleton width={120} height={24} />);
    const el = container.querySelector("[aria-hidden]");
    expect(el).toBeInTheDocument();
    // Skeleton forwards dimensions via CSS custom properties so consumers can
    // reach them with `style={{ "--pa-skeleton-w": "120px" }}`. The element
    // applies them through `.pa-skeleton { width: var(--pa-skeleton-w); }`.
    expect(el).toHaveStyle({
      "--pa-skeleton-w": "120px",
      "--pa-skeleton-h": "24px",
    } as Record<string, string>);
  });
});

describe("Spinner", () => {
  it("renders a status role with a loading label", () => {
    render(<Spinner />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", "Loading");
  });
});
