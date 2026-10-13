import { useCallback, useEffect, useState } from "react";
import { getIpcClient } from "../../ipc/client";
import type { ThoughtTreeState } from "../../ipc/contract";
import "./thoughtTree.css";

export function ThoughtTreePanel() {
  const [tree, setTree] = useState<ThoughtTreeState | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [specHypothesis, setSpecHypothesis] = useState<string>("");

  const client = getIpcClient();

  const loadTree = useCallback(async () => {
    try {
      setLoading(true);
      const state = await client.getThoughtTree();
      setTree(state);
      setSelectedNodeId((prev) => prev || (state.nodes.length > 0 ? state.nodes[0].id : ""));
    } catch (err) {
      console.error("Failed to load thought tree:", err);
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void loadTree();
  }, [loadTree]);

  const handleBranch = async () => {
    if (!selectedNodeId || !specHypothesis) return;
    try {
      setActionLoading(true);
      const updated = await client.runSpeculativeBranch(selectedNodeId, specHypothesis);
      setTree(updated);
      setSpecHypothesis("");
    } catch (err) {
      console.error("Failed to run speculative branch:", err);
    } finally {
      setActionLoading(false);
    }
  };

  const handlePrune = async (nodeId: string) => {
    try {
      setActionLoading(true);
      const updated = await client.pruneThoughtBranch(nodeId);
      setTree(updated);
    } catch (err) {
      console.error("Failed to prune branch:", err);
    } finally {
      setActionLoading(false);
    }
  };

  const handlePromote = async (nodeId: string) => {
    try {
      setActionLoading(true);
      const updated = await client.promoteThoughtBranch(nodeId);
      setTree(updated);
    } catch (err) {
      console.error("Failed to promote branch:", err);
    } finally {
      setActionLoading(false);
    }
  };

  const selectedNode = tree?.nodes.find((n) => n.id === selectedNodeId);

  return (
    <div className="thought-tree-panel" data-testid="thought-tree-panel">
      <div className="thought-tree-header">
        <div className="thought-tree-header-info">
          <h2>Speculative Tree-of-Thoughts Execution Engine (ToT / FoT)</h2>
          <p>
            Explores concurrent solution candidates with evaluator heuristics, preflight checks, and zero-copy
            rollback.
          </p>
          <div className="skill-distill-badges">
            <span className="cua-badge active">Engine: Tree of Thoughts (Yao et al.)</span>
            <span className="cua-badge guard">Active Goal: {tree?.goal ?? "Isolate spec execution"}</span>
            <span className="cua-badge">Nodes ({tree?.nodes.length ?? 0})</span>
          </div>
        </div>
        <div className="cua-header-actions">
          <button type="button" className="cua-btn" onClick={() => void loadTree()} disabled={loading}>
            Refresh Tree
          </button>
        </div>
      </div>

      <div className="thought-tree-grid">
        <div className="thought-tree-graph-view">
          <div className="cua-section-title">Decision Tree Exploration DAG</div>
          <div className="cua-window-list" style={{ maxHeight: "380px" }} data-testid="thought-nodes-list">
            {tree?.nodes.map((node) => {
              const isBest = tree.bestNodeId === node.id;
              return (
                <div
                  key={node.id}
                  className={`thought-node-card ${node.status} ${selectedNodeId === node.id ? "selected" : ""}`}
                  style={{ marginLeft: `${node.depth * 18}px` }}
                  onClick={() => setSelectedNodeId(node.id)}
                  data-testid={`thought-node-${node.id}`}
                >
                  <div className="thought-node-top">
                    <span className="thought-node-type">
                      {node.type} {isBest ? "★ WINNER" : ""}
                    </span>
                    <span className={`thought-node-score ${node.score >= 0.8 ? "high" : "low"}`}>
                      Score: {(node.score * 100).toFixed(0)}%
                    </span>
                  </div>
                  <div className="thought-node-label">{node.label}</div>
                  {node.rationale && <div className="thought-node-rationale">{node.rationale}</div>}
                </div>
              );
            })}
          </div>

          <div className="cua-action-form" style={{ marginTop: "1rem" }}>
            <div className="cua-section-title">Spawn Speculative Branch</div>
            <div className="cua-form-row">
              <span className="cua-form-label">Hypothesis:</span>
              <input
                type="text"
                className="cua-input"
                value={specHypothesis}
                onChange={(e) => setSpecHypothesis(e.target.value)}
                placeholder="Alternative candidate branch hypothesis..."
                data-testid="input-spec-hypothesis"
              />
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                className="cua-btn primary"
                onClick={() => void handleBranch()}
                disabled={actionLoading || !specHypothesis || !selectedNodeId}
                data-testid="btn-spawn-branch"
              >
                {actionLoading ? "Evaluating..." : "Explore Speculative Branch"}
              </button>
            </div>
          </div>
        </div>

        <div className="thought-node-detail-view">
          <div className="cua-section-title">
            Candidate Branch Inspector {selectedNode ? `— [${selectedNode.type}]` : ""}
          </div>
          {selectedNode ? (
            <div className="skill-editor-container">
              <div className="skill-stats-badge">
                Depth: {selectedNode.depth} • Status: {selectedNode.status.toUpperCase()} • Confidence Score:{" "}
                {(selectedNode.score * 100).toFixed(0)}%
              </div>
              <div style={{ fontSize: "0.9rem", fontWeight: 600, color: "#f8fafc" }}>
                {selectedNode.label}
              </div>
              {selectedNode.rationale && (
                <div style={{ fontSize: "0.82rem", color: "#94a3b8" }}>
                  <strong>Evaluator Rationale:</strong> {selectedNode.rationale}
                </div>
              )}

              {selectedNode.diffSnippet && (
                <div>
                  <div className="cua-section-title" style={{ margin: "0.5rem 0 0.25rem 0" }}>
                    Candidate Code Diff
                  </div>
                  <pre className="thought-diff-viewer" data-testid="thought-diff-snippet">
                    {selectedNode.diffSnippet}
                  </pre>
                </div>
              )}

              <div className="skill-actions-row" style={{ marginTop: "auto" }}>
                <button
                  type="button"
                  className="cua-btn"
                  style={{ color: "#ef4444" }}
                  onClick={() => void handlePrune(selectedNode.id)}
                  disabled={actionLoading || selectedNode.status === "pruned"}
                  data-testid="btn-prune-branch"
                >
                  {selectedNode.status === "pruned" ? "Branch Pruned" : "Prune Branch (Fail-Closed)"}
                </button>
                <button
                  type="button"
                  className="cua-btn primary"
                  onClick={() => void handlePromote(selectedNode.id)}
                  disabled={actionLoading || selectedNode.status === "promoted"}
                  data-testid="btn-promote-branch"
                >
                  {selectedNode.status === "promoted" ? "Winning Branch Active" : "Promote as Winner"}
                </button>
              </div>
            </div>
          ) : (
            <div style={{ color: "#64748b", padding: "2rem" }}>
              Select a node from the exploration tree to inspect details.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
