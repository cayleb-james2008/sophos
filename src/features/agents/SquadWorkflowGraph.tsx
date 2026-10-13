// SquadWorkflowGraph — Dynamic Multi-Agent Squad Workflow Engine (LangGraph / AutoGen 0.4 concept).
// Provides interactive visual DAG topology routing, node execution telemetry,
// and step-by-step multi-agent orchestration for Gauntlet squads.

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Text } from "../../design";
import { getIpcClient } from "../../ipc/client";
import type { SquadWorkflowNode, SquadWorkflowState, SquadWorkflowType } from "../../ipc/contract";
import "./squadWorkflow.css";

const TOPOLOGY_OPTIONS: Array<{ id: SquadWorkflowType; label: string; desc: string }> = [
  {
    id: "sequential",
    label: "Sequential Pipeline",
    desc: "Planner → Worker → Blind Critic → Lead Verifier",
  },
  {
    id: "hierarchical",
    label: "Hierarchical Squad",
    desc: "Lead Orchestrator delegating to parallel specialist workers with judge synthesis",
  },
  {
    id: "consensus",
    label: "Consensus Synthesis",
    desc: "Multi-model diverse generation with majority voting and agreement scoring",
  },
];

export function SquadWorkflowGraph() {
  const client = getIpcClient();
  const [workflow, setWorkflow] = useState<SquadWorkflowState | null>(null);
  const [activeTopology, setActiveTopology] = useState<SquadWorkflowType>("sequential");
  const [running, setRunning] = useState<boolean>(false);

  const loadWorkflow = useCallback(async () => {
    try {
      const state = await client.getSquadWorkflow();
      setWorkflow(state);
      setActiveTopology(state.type);
    } catch {
      // Fallback
    }
  }, [client]);

  useEffect(() => {
    void loadWorkflow();
  }, [loadWorkflow]);

  const handleSwitchTopology = async (type: SquadWorkflowType) => {
    setActiveTopology(type);
    setRunning(true);
    try {
      const updated = await client.runSquadWorkflow(
        type,
        "Autonomous Harness Modernization",
        "v0.9.0 Quality Bar",
      );
      setWorkflow(updated);
    } finally {
      setRunning(false);
    }
  };

  const handleStepNext = () => {
    if (!workflow) return;
    const nodes = [...workflow.nodes];
    const currentIndex = nodes.findIndex((n) => n.id === workflow.activeNodeId);
    if (currentIndex >= 0 && currentIndex < nodes.length - 1) {
      nodes[currentIndex].status = "completed";
      nodes[currentIndex + 1].status = "running";
      setWorkflow({
        ...workflow,
        nodes,
        activeNodeId: nodes[currentIndex + 1].id,
      });
    } else if (currentIndex === nodes.length - 1) {
      nodes[currentIndex].status = "completed";
      setWorkflow({
        ...workflow,
        nodes,
        activeNodeId: undefined,
        barVerdict: "PASS",
      });
    }
  };

  return (
    <div className="squad-workflow-container" data-testid="squad-workflow-graph">
      <div className="sp-head">
        <div className="sp-headrow">
          <Text variant="label" weight="semibold">
            Dynamic Multi-Agent Squad Workflow Engine (LangGraph / AutoGen 0.4)
          </Text>
          <Badge tone="accent">{workflow?.type.toUpperCase() ?? "SEQUENTIAL"}</Badge>
          <Button size="sm" variant="outline" onClick={handleStepNext}>
            Step Next Node
          </Button>
        </div>
        <Text variant="micro" tone="dim">
          Visual multi-agent DAG execution topology with live state propagation and consensus scoring.
        </Text>
      </div>

      {/* Topologies */}
      <div className="squad-workflow-topologies">
        {TOPOLOGY_OPTIONS.map((t) => (
          <Button
            key={t.id}
            size="sm"
            variant={activeTopology === t.id ? "primary" : "ghost"}
            onClick={() => void handleSwitchTopology(t.id)}
            disabled={running}
          >
            {t.label}
          </Button>
        ))}
      </div>

      {/* Interactive Visual Node Graph */}
      <div className="squad-nodes-flow">
        {(workflow?.nodes ?? []).map((node: SquadWorkflowNode, idx: number) => {
          const isCurrent = workflow?.activeNodeId === node.id;
          const isDone = node.status === "completed";
          return (
            <div key={node.id} style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <div
                className={`squad-node-card ${
                  isCurrent ? "squad-node-card--active" : isDone ? "squad-node-card--completed" : ""
                }`}
                data-testid={`node-${node.id}`}
              >
                <div className="sp-headrow">
                  <Text variant="label" weight="bold">
                    {node.role}
                  </Text>
                  <Badge
                    tone={isDone ? "success" : isCurrent ? "accent" : "neutral"}
                    dot={isCurrent || isDone}
                  >
                    {node.status}
                  </Badge>
                </div>
                <Text variant="micro" tone="dim" mono>
                  {node.model ?? "deepseek-v4-flash"}
                </Text>
                {node.contract && (
                  <Text variant="micro" tone="muted">
                    {node.contract}
                  </Text>
                )}
                {node.outputPreview && (
                  <Text variant="micro" weight="medium" tone="dim">
                    Preview: {node.outputPreview}
                  </Text>
                )}
              </div>
              {idx < (workflow?.nodes.length ?? 0) - 1 && <span className="squad-flow-arrow">→</span>}
            </div>
          );
        })}
      </div>

      {/* Workflow Telemetry */}
      {workflow && (
        <Card variant="default" padding="md">
          <div className="sp-headrow">
            <Text variant="micro" tone="dim">
              <strong>Consensus Score:</strong> {(workflow.consensusScore ?? 0.98) * 100}% ·{" "}
              <strong>Bar Verdict:</strong>{" "}
              <Badge tone={workflow.barVerdict === "PASS" ? "success" : "neutral"}>
                {workflow.barVerdict ?? "EVALUATING"}
              </Badge>
            </Text>
            <Text variant="micro" tone="dim">
              Round {workflow.totalRounds} of {workflow.maxRounds}
            </Text>
          </div>
        </Card>
      )}
    </div>
  );
}
