import React, { useEffect, useState, useCallback } from "react";
import type {
  DesktopActionResult,
  DesktopUiAction,
  DesktopUiElement,
  DesktopWindowInfo,
} from "../../ipc/contract";
import { getIpcClient } from "../../ipc/client";
import "./cua.css";

export const CuaControlPanel: React.FC = () => {
  const [windows, setWindows] = useState<DesktopWindowInfo[]>([]);
  const [selectedWindowId, setSelectedWindowId] = useState<string>("");
  const [treeRoot, setTreeRoot] = useState<DesktopUiElement | null>(null);
  const [selectedElementId, setSelectedElementId] = useState<string>("");
  const [screenshot, setScreenshot] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [lastResult, setLastResult] = useState<DesktopActionResult | null>(null);

  // Action form state
  const [actionKind, setActionKind] = useState<DesktopUiAction["kind"]>("click");
  const [targetX, setTargetX] = useState<number>(200);
  const [targetY, setTargetY] = useState<number>(140);
  const [actionText, setActionText] = useState<string>("");
  const [actionKey, setActionKey] = useState<string>("Enter");

  const client = getIpcClient();

  const loadWindows = useCallback(async () => {
    try {
      setLoading(true);
      const list = await client.listDesktopWindows();
      setWindows(list);
      setSelectedWindowId((prev) => prev || (list.length > 0 ? list[0].id : ""));
    } catch (err) {
      console.error("Failed to load desktop windows:", err);
    } finally {
      setLoading(false);
    }
  }, [client]);

  const loadWindowDetails = useCallback(
    async (winId: string) => {
      if (!winId) return;
      try {
        const [elemTree, snap] = await Promise.all([
          client.inspectDesktopWindow(winId),
          client.captureDesktopScreenshot(winId),
        ]);
        setTreeRoot(elemTree);
        setScreenshot(snap);
      } catch (err) {
        console.error("Failed to load window details:", err);
      }
    },
    [client],
  );

  useEffect(() => {
    void loadWindows();
  }, [loadWindows]);

  useEffect(() => {
    if (selectedWindowId) {
      void loadWindowDetails(selectedWindowId);
    }
  }, [selectedWindowId, loadWindowDetails]);

  const handleSelectElement = (elem: DesktopUiElement) => {
    setSelectedElementId(elem.id);
    const centerX = Math.round(elem.bounds.x + elem.bounds.width / 2);
    const centerY = Math.round(elem.bounds.y + elem.bounds.height / 2);
    setTargetX(centerX);
    setTargetY(centerY);
  };

  const handleDispatchAction = async () => {
    if (!selectedWindowId) return;
    try {
      setActionLoading(true);
      const action: DesktopUiAction = {
        kind: actionKind,
        targetElementId: selectedElementId || undefined,
        x: targetX,
        y: targetY,
        text: actionKind === "type" ? actionText : undefined,
        key: actionKind === "keypress" ? actionKey : undefined,
      };
      const res = await client.dispatchDesktopAction(selectedWindowId, action);
      setLastResult(res);
      if (res.screenshot) {
        setScreenshot(res.screenshot);
      }
    } catch (err) {
      console.error("Action execution failed:", err);
    } finally {
      setActionLoading(false);
    }
  };

  const renderTreeNode = (elem: DesktopUiElement, depth = 0) => (
    <div key={elem.id} style={{ paddingLeft: `${depth * 12}px` }}>
      <div
        className={`cua-tree-node ${selectedElementId === elem.id ? "selected" : ""}`}
        onClick={() => handleSelectElement(elem)}
        data-testid={`tree-node-${elem.id}`}
      >
        <span className="cua-tree-role">[{elem.role}]</span>
        <span className="cua-tree-name">{elem.name}</span>
      </div>
      {elem.children?.map((child) => renderTreeNode(child, depth + 1))}
    </div>
  );

  const selectedWin = windows.find((w) => w.id === selectedWindowId);

  return (
    <div className="cua-panel" data-testid="cua-control-panel">
      <div className="cua-header">
        <div className="cua-header-info">
          <h2>Native Windows Computer-Use Action Space (CUA)</h2>
          <p>Autonomous background UI automation and element inspection without stealing mouse focus.</p>
          <div className="cua-header-badges">
            <span className="cua-badge active">UIA Engine Active</span>
            <span className="cua-badge guard">Background Guard: Enforced</span>
            <span className="cua-badge">OS: Windows 11</span>
          </div>
        </div>
        <div className="cua-header-actions">
          <button type="button" className="cua-btn" onClick={() => void loadWindows()} disabled={loading}>
            Refresh Windows
          </button>
          <button
            type="button"
            className="cua-btn primary"
            onClick={() => void loadWindowDetails(selectedWindowId)}
            disabled={!selectedWindowId || loading}
          >
            Capture Live Snapshot
          </button>
        </div>
      </div>

      <div className="cua-grid">
        <div className="cua-left-pane">
          <div>
            <div className="cua-section-title">Running Applications ({windows.length})</div>
            <div className="cua-window-list" data-testid="window-list">
              {windows.map((w) => (
                <div
                  key={w.id}
                  className={`cua-window-card ${selectedWindowId === w.id ? "selected" : ""}`}
                  onClick={() => setSelectedWindowId(w.id)}
                  data-testid={`win-card-${w.id}`}
                >
                  <div className="cua-window-title">{w.title}</div>
                  <div className="cua-window-meta">
                    <span>{w.processName}</span>
                    <span>PID: {w.pid}</span>
                    <span>
                      {w.bounds.width}×{w.bounds.height}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
            <div className="cua-section-title">UI Automation Accessibility Tree</div>
            <div className="cua-tree-container" data-testid="accessibility-tree">
              {treeRoot ? (
                renderTreeNode(treeRoot)
              ) : (
                <span style={{ color: "#64748b" }}>Select a window to inspect accessibility elements</span>
              )}
            </div>
          </div>
        </div>

        <div className="cua-right-pane">
          <div className="cua-section-title">
            Live Background Window Snapshot {selectedWin ? `— ${selectedWin.title}` : ""}
          </div>
          <div className="cua-canvas-wrapper" data-testid="screenshot-wrapper">
            {screenshot ? (
              <img src={screenshot} alt="Window Snapshot" className="cua-canvas-img" />
            ) : (
              <span style={{ color: "#64748b" }}>No snapshot loaded</span>
            )}
          </div>

          <div className="cua-action-form">
            <div className="cua-section-title">Background Action Dispatcher</div>
            <div className="cua-form-row">
              <span className="cua-form-label">Action Kind:</span>
              <select
                className="cua-select"
                value={actionKind}
                onChange={(e) => setActionKind(e.target.value as DesktopUiAction["kind"])}
                data-testid="action-kind-select"
              >
                <option value="click">Click Element / Coords</option>
                <option value="type">Type Text Stream</option>
                <option value="keypress">Send Key Event</option>
                <option value="hover">Hover Coordinates</option>
              </select>
            </div>

            <div className="cua-form-row">
              <span className="cua-form-label">Target (X, Y):</span>
              <input
                type="number"
                className="cua-input"
                value={targetX}
                onChange={(e) => setTargetX(Number(e.target.value))}
                placeholder="X"
                data-testid="input-target-x"
              />
              <input
                type="number"
                className="cua-input"
                value={targetY}
                onChange={(e) => setTargetY(Number(e.target.value))}
                placeholder="Y"
                data-testid="input-target-y"
              />
            </div>

            {actionKind === "type" && (
              <div className="cua-form-row">
                <span className="cua-form-label">Text:</span>
                <input
                  type="text"
                  className="cua-input"
                  value={actionText}
                  onChange={(e) => setActionText(e.target.value)}
                  placeholder="Enter text to type..."
                  data-testid="input-action-text"
                />
              </div>
            )}

            {actionKind === "keypress" && (
              <div className="cua-form-row">
                <span className="cua-form-label">Key:</span>
                <input
                  type="text"
                  className="cua-input"
                  value={actionKey}
                  onChange={(e) => setActionKey(e.target.value)}
                  placeholder="Enter key (e.g. Enter, Tab, Escape)..."
                  data-testid="input-action-key"
                />
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "0.25rem" }}>
              <button
                type="button"
                className="cua-btn primary"
                onClick={() => void handleDispatchAction()}
                disabled={actionLoading || !selectedWindowId}
                data-testid="dispatch-action-btn"
              >
                {actionLoading ? "Executing in Background..." : "Dispatch Background Action"}
              </button>
            </div>
          </div>

          {lastResult && (
            <div className="cua-result-banner" data-testid="action-result-banner">
              [Status: {lastResult.success ? "SUCCESS" : "FAILED"}] {lastResult.message} (
              {lastResult.durationMs}ms)
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
