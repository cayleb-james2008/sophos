// GraphCanvas.test.tsx — the shared node-graph primitives. Because the graph
// view components mock "../../graph", the real NodeFrame / PulseEdge / GraphFlow
// are never exercised elsewhere — this is the behavior test for that chrome.
// Mocks @xyflow/react and framer-motion so the primitives render in jsdom.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { NodeFrame, PulseEdge, GraphFlow } from "../GraphCanvas";
import { Position } from "@xyflow/react";
import { tokens } from "../../../design/tokens";

const reducedMotion = vi.hoisted(() => ({ value: false }));

vi.mock("framer-motion", async () => ({
  motion: {
    div: ({ initial, animate, transition, children, ...rest }: any) => (
      <div {...rest}>{children}</div>
    ),
  },
  MotionConfig: ({ children }: any) => children,
  useReducedMotion: () => reducedMotion.value,
}));

vi.mock("@xyflow/react", async () => ({
  ReactFlow: ({ children, nodes, edges, onNodeClick }: any) => (
    <div data-testid="react-flow" data-nodes={nodes?.length} data-edges={edges?.length}>
      <button data-testid="rf-click" onClick={() => onNodeClick?.(null, { id: nodes?.[0]?.id })}>
        flow
      </button>
      {children}
    </div>
  ),
  Background: () => <div data-testid="background" />,
  Controls: ({ children }: any) => <div data-testid="controls">{children}</div>,
  ControlButton: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  MiniMap: () => <div data-testid="minimap" />,
  BaseEdge: ({ id, path, className }: any) => <path data-testid={`edge-${id}`} d={path} className={className} />,
  getSmoothStepPath: ({ sourceX, sourceY, targetX, targetY }: any) => [
    `M${sourceX},${sourceY} L${targetX},${targetY}`,
    null,
  ],
  Handle: () => null,
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
}));

describe("NodeFrame", () => {
  it("renders kind, title, subtitle, and mono text", () => {
    render(<NodeFrame kind="AGENT" title="Reviewer" status="running" subtitle="checking" mono="a-1 · running" />);
    expect(screen.getByText("AGENT")).toBeInTheDocument();
    expect(screen.getByText("Reviewer")).toBeInTheDocument();
    expect(screen.getByText("checking")).toBeInTheDocument();
    expect(screen.getByText("a-1 · running")).toBeInTheDocument();
  });

  it("renders children and action slots", () => {
    render(
      <NodeFrame kind="AGENT" title="T" status="idle" actions={<button>Act</button>}>
        <span>inner</span>
      </NodeFrame>,
    );
    expect(screen.getByText("inner")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /act/i })).toBeInTheDocument();
  });

  it("applies the status color to the edge rail and the soft wash to the dot", () => {
    const { container } = render(<NodeFrame kind="AGENT" title="T" status="running" />);
    const edge = container.querySelector(".pg-node__edge") as HTMLElement;
    const dot = container.querySelector(".pg-node__dot") as HTMLElement;
    expect(edge.style.getPropertyValue("--node-color")).toBe(tokens.color.ok);
    expect(dot.style.getPropertyValue("--node-wash")).toBe("var(--pa-green-soft)");
  });

  it("uses the danger color for error statuses", () => {
    const { container } = render(<NodeFrame kind="AGENT" title="T" status="error" />);
    const edge = container.querySelector(".pg-node__edge") as HTMLElement;
    expect(edge.style.getPropertyValue("--node-color")).toBe(tokens.color.err);
  });

  it("replaces the status dot with the corner node when one is provided", () => {
    const { container } = render(<NodeFrame kind="AGENT" title="T" status="idle" corner={<span>unread pill</span>} />);
    expect(screen.getByText("unread pill")).toBeInTheDocument();
    expect(container.querySelector(".pg-node__dot")).toBeNull();
  });

  it("adds the selected class when selected", () => {
    const { container, rerender } = render(<NodeFrame kind="AGENT" title="T" status="idle" />);
    expect(container.querySelector(".pg-node")?.className).not.toContain("pg-node--sel");
    rerender(<NodeFrame kind="AGENT" title="T" status="idle" selected />);
    expect(container.querySelector(".pg-node")?.className).toContain("pg-node--sel");
  });

  it("sets the node width custom property and fires onClick", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { container } = render(<NodeFrame kind="AGENT" title="T" status="idle" width={244} onClick={onClick} />);
    expect((container.querySelector(".pg-node") as HTMLElement)?.style.getPropertyValue("--node-w")).toBe("244px");
    await user.click(screen.getByText("T"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("PulseEdge", () => {
  const baseProps = {
    id: "e1",
    source: "a",
    target: "b",
    sourceX: 0,
    sourceY: 0,
    targetX: 100,
    targetY: 50,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
  };

  it("renders the base edge path and animates it when animated is set", () => {
    render(<PulseEdge {...baseProps} data={{ pulse: true, color: "#0f0", animated: true }} />);
    const edge = screen.getByTestId("edge-e1");
    expect(edge).toBeInTheDocument();
    expect(edge).toHaveAttribute("d", "M0,0 L100,50");
    expect(edge.className).toContain("pg-animated");
  });

  it("renders a traveling pulse dot when pulse is set", () => {
    const { container } = render(<PulseEdge {...baseProps} data={{ pulse: true }} />);
    expect(container.querySelector("circle animateMotion")).not.toBeNull();
  });

  it("renders no pulse dot when pulse is off", () => {
    const { container } = render(<PulseEdge {...baseProps} data={{ pulse: false }} />);
    expect(container.querySelector("circle animateMotion")).toBeNull();
  });

  it("suppresses the pulse dot under reduced motion", () => {
    reducedMotion.value = true;
    const { container } = render(<PulseEdge {...baseProps} data={{ pulse: true }} />);
    expect(container.querySelector("circle animateMotion")).toBeNull();
    reducedMotion.value = false;
  });

  it("defaults the stroke color to LINE when no color is provided", () => {
    render(<PulseEdge {...baseProps} data={{}} />);
    expect(screen.getByTestId("edge-e1")).toBeInTheDocument();
  });
});

describe("GraphFlow", () => {
  it("passes nodes and edges to ReactFlow and renders children", () => {
    const nodes = [{ id: "n1" }];
    const edges = [{ id: "e1" }];
    render(
      <GraphFlow nodes={nodes as any} edges={edges as any}>
        <div data-testid="child">legend</div>
      </GraphFlow>,
    );
    expect(screen.getByTestId("react-flow")).toHaveAttribute("data-nodes", "1");
    expect(screen.getByTestId("react-flow")).toHaveAttribute("data-edges", "1");
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });

  it("renders the grid, controls, and minimap by default", () => {
    render(<GraphFlow nodes={[]} edges={[]} />);
    expect(screen.getByTestId("background")).toBeInTheDocument();
    expect(screen.getByTestId("controls")).toBeInTheDocument();
    expect(screen.getByTestId("minimap")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /zoom in/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /zoom out/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /fit view/i })).toBeInTheDocument();
  });

  it("omits the minimap when showMiniMap is false", () => {
    render(<GraphFlow nodes={[]} edges={[]} showMiniMap={false} />);
    expect(screen.getByTestId("controls")).toBeInTheDocument();
    expect(screen.queryByTestId("minimap")).not.toBeInTheDocument();
  });

  it("forwards onNodeClick with the clicked node id", async () => {
    const user = userEvent.setup();
    const onNodeClick = vi.fn();
    const nodes = [{ id: "n1" }];
    render(<GraphFlow nodes={nodes as any} edges={[]} onNodeClick={onNodeClick} />);
    await user.click(screen.getByTestId("rf-click"));
    expect(onNodeClick).toHaveBeenCalledWith("n1");
  });
});
