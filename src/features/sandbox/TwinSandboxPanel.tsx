import { useCallback, useEffect, useState } from "react";
import { getIpcClient } from "../../ipc/client";
import type { TwinDiffReport, WorkspaceTwin } from "../../ipc/contract";
import "./twinSandbox.css";

export function TwinSandboxPanel() {
  const [twins, setTwins] = useState<WorkspaceTwin[]>([]);
  const [selectedTwinId, setSelectedTwinId] = useState<string>("");
  const [diffReport, setDiffReport] = useState<TwinDiffReport | null>(null);
  const [execOutput, setExecOutput] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // New twin inputs
  const [newTwinName, setNewTwinName] = useState<string>("");
  const [execCommand, setExecCommand] = useState<string>("npm test -- --run");

  const client = getIpcClient();

  const loadTwins = useCallback(async () => {
    try {
      setLoading(true);
      const list = await client.listWorkspaceTwins();
      setTwins(list);
      setSelectedTwinId((prev) => prev || (list.length > 0 ? list[0].id : ""));
    } catch (err) {
      console.error("Failed to load workspace twins:", err);
    } finally {
      setLoading(false);
    }
  }, [client]);

  const loadTwinDiff = useCallback(
    async (twinId: string) => {
      if (!twinId) return;
      try {
        const report = await client.diffWorkspaceTwin(twinId);
        setDiffReport(report);
      } catch (err) {
        console.error("Failed to load twin diff:", err);
      }
    },
    [client],
  );

  useEffect(() => {
    void loadTwins();
  }, [loadTwins]);

  useEffect(() => {
    if (selectedTwinId) {
      void loadTwinDiff(selectedTwinId);
    }
  }, [selectedTwinId, loadTwinDiff]);

  const handleCreateTwin = async () => {
    if (!newTwinName) return;
    try {
      setActionLoading(true);
      const created = await client.createWorkspaceTwin(newTwinName);
      setStatusMessage(`Created zero-copy ephemeral workspace twin "${created.name}".`);
      setNewTwinName("");
      await loadTwins();
      setSelectedTwinId(created.id);
    } catch (err) {
      console.error("Failed to create twin:", err);
      setStatusMessage(`Create failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleExecute = async () => {
    if (!selectedTwinId || !execCommand) return;
    try {
      setActionLoading(true);
      const res = await client.executeInTwin(selectedTwinId, execCommand);
      setExecOutput(res.stdout);
      setStatusMessage(`Executed "${execCommand}" inside twin in ${res.durationMs}ms.`);
      await loadTwins();
      await loadTwinDiff(selectedTwinId);
    } catch (err) {
      console.error("Twin execution failed:", err);
    } finally {
      setActionLoading(false);
    }
  };

  const handleMerge = async (twinId: string) => {
    try {
      setActionLoading(true);
      const res = await client.mergeWorkspaceTwin(twinId);
      setStatusMessage(`Merged twin into primary workspace (Commit: ${res.mergedCommit}).`);
      await loadTwins();
    } catch (err) {
      console.error("Merge failed:", err);
    } finally {
      setActionLoading(false);
    }
  };

  const handleRollback = async (twinId: string) => {
    try {
      setActionLoading(true);
      const res = await client.rollbackWorkspaceTwin(twinId);
      setStatusMessage(res.message);
      await loadTwins();
    } catch (err) {
      console.error("Rollback failed:", err);
    } finally {
      setActionLoading(false);
    }
  };

  const selectedTwin = twins.find((t) => t.id === selectedTwinId);

  return (
    <div className="twin-sandbox-panel" data-testid="twin-sandbox-panel">
      <div className="twin-sandbox-header">
        <div className="twin-sandbox-header-info">
          <h2>Ephemeral Workspace Twin Sandbox (Devin Sandbox / Worktrees)</h2>
          <p>
            Isolates risky refactors, destructive builds, and multi-file tests in zero-copy Git worktrees with
            instant merge and rollback.
          </p>
          <div className="skill-distill-badges">
            <span className="cua-badge active">Isolation: Zero-Copy Worktree</span>
            <span className="cua-badge guard">Fail-Closed Rollback: Armed</span>
            <span className="cua-badge">Active Twins ({twins.length})</span>
          </div>
        </div>
        <div className="cua-header-actions">
          <button type="button" className="cua-btn" onClick={() => void loadTwins()} disabled={loading}>
            Refresh Twins
          </button>
        </div>
      </div>

      {statusMessage && (
        <div className="cua-result-banner" data-testid="twin-status-banner">
          {statusMessage}
        </div>
      )}

      <div className="twin-sandbox-grid">
        <div className="twin-sandbox-left">
          <div>
            <div className="cua-section-title">Spawn Ephemeral Worktree Twin</div>
            <div className="cua-action-form" style={{ marginBottom: "1rem" }}>
              <div className="cua-form-row">
                <span className="cua-form-label">Twin Name:</span>
                <input
                  type="text"
                  className="cua-input"
                  value={newTwinName}
                  onChange={(e) => setNewTwinName(e.target.value)}
                  placeholder="e.g. security-audit-branch..."
                  data-testid="input-twin-name"
                />
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  className="cua-btn primary"
                  onClick={() => void handleCreateTwin()}
                  disabled={actionLoading || !newTwinName}
                  data-testid="btn-create-twin"
                >
                  {actionLoading ? "Spawning..." : "Spawn Zero-Copy Twin"}
                </button>
              </div>
            </div>

            <div className="cua-section-title">Active Twins ({twins.length})</div>
            <div className="cua-window-list" style={{ maxHeight: "280px" }} data-testid="twins-list">
              {twins.map((t) => (
                <div
                  key={t.id}
                  className={`twin-card ${selectedTwinId === t.id ? "selected" : ""}`}
                  onClick={() => setSelectedTwinId(t.id)}
                  data-testid={`twin-card-${t.id}`}
                >
                  <div className="twin-card-top">
                    <span className="twin-card-name">{t.name}</span>
                    <span
                      style={{
                        fontSize: "0.72rem",
                        color:
                          t.status === "clean"
                            ? "#34d399"
                            : t.status === "merged"
                              ? "#38bdf8"
                              : t.status === "rolled_back"
                                ? "#ef4444"
                                : "#f59e0b",
                        fontFamily: "monospace",
                      }}
                    >
                      {t.status.toUpperCase()}
                    </span>
                  </div>
                  <div className="twin-card-branch">{t.branch}</div>
                  <div className="twin-card-meta">
                    <span>{t.modifiedFilesCount} files modified</span>
                    <span>Base: {t.baseCommit.slice(0, 7)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="twin-sandbox-right">
          <div className="cua-section-title">
            Twin Sandbox Inspector {selectedTwin ? `— ${selectedTwin.name}` : ""}
          </div>
          {selectedTwin ? (
            <div className="twin-diff-container">
              <div className="skill-stats-badge">
                Status: {selectedTwin.status.toUpperCase()} • Path: {selectedTwin.worktreePath}
              </div>

              <div className="cua-section-title" style={{ margin: "0.25rem 0" }}>
                Isolated Twin Command Execution
              </div>
              <div className="cua-form-row">
                <input
                  type="text"
                  className="cua-input"
                  value={execCommand}
                  onChange={(e) => setExecCommand(e.target.value)}
                  placeholder="Command to run in isolated twin..."
                  data-testid="input-twin-exec-command"
                />
                <button
                  type="button"
                  className="cua-btn"
                  onClick={() => void handleExecute()}
                  disabled={actionLoading}
                  data-testid="btn-exec-in-twin"
                >
                  Run in Twin
                </button>
              </div>

              {execOutput && (
                <div>
                  <div className="cua-section-title" style={{ margin: "0.25rem 0" }}>
                    Isolated Execution Log
                  </div>
                  <pre className="twin-terminal-preview" data-testid="twin-exec-output">
                    {execOutput}
                  </pre>
                </div>
              )}

              {diffReport && (
                <div>
                  <div className="cua-section-title" style={{ margin: "0.5rem 0 0.25rem 0" }}>
                    Side-by-Side Twin Git Diff (+{diffReport.insertions} / -{diffReport.deletions})
                  </div>
                  <div className="twin-files-list" style={{ marginBottom: "0.5rem" }}>
                    {diffReport.filesChanged.map((f) => (
                      <span key={f} className="twin-file-tag">
                        {f}
                      </span>
                    ))}
                  </div>
                  <pre className="twin-diff-preview" data-testid="twin-diff-preview">
                    {diffReport.diffText}
                  </pre>
                </div>
              )}

              <div className="skill-actions-row" style={{ marginTop: "auto" }}>
                <button
                  type="button"
                  className="cua-btn"
                  style={{ color: "#ef4444" }}
                  onClick={() => void handleRollback(selectedTwin.id)}
                  disabled={actionLoading || selectedTwin.status === "rolled_back"}
                  data-testid="btn-rollback-twin"
                >
                  {selectedTwin.status === "rolled_back" ? "Twin Discarded" : "Rollback & Prune Twin"}
                </button>
                <button
                  type="button"
                  className="cua-btn primary"
                  onClick={() => void handleMerge(selectedTwin.id)}
                  disabled={
                    actionLoading || selectedTwin.status === "merged" || selectedTwin.status === "rolled_back"
                  }
                  data-testid="btn-merge-twin"
                >
                  {selectedTwin.status === "merged" ? "Changes Merged" : "Merge Twin into Primary Workspace"}
                </button>
              </div>
            </div>
          ) : (
            <div style={{ color: "#64748b", padding: "2rem" }}>
              Select an active workspace twin to inspect diff and execute isolated tasks.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
