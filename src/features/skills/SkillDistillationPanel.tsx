import { useCallback, useEffect, useState } from "react";
import { getIpcClient } from "../../ipc/client";
import type { DistilledSkill } from "../../ipc/contract";
import "./skillDistillation.css";

export function SkillDistillationPanel() {
  const [skills, setSkills] = useState<DistilledSkill[]>([]);
  const [selectedSkillId, setSelectedSkillId] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // New distillation input
  const [sourceSession, setSourceSession] = useState<string>("session-fix-mcp-tests");
  const [newSkillName, setNewSkillName] = useState<string>("");

  const client = getIpcClient();

  const loadSkills = useCallback(async () => {
    try {
      setLoading(true);
      const list = await client.listDistilledSkills();
      setSkills(list);
      setSelectedSkillId((prev) => prev || (list.length > 0 ? list[0].id : ""));
    } catch (err) {
      console.error("Failed to load distilled skills:", err);
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void loadSkills();
  }, [loadSkills]);

  const handleDistill = async () => {
    if (!sourceSession) return;
    try {
      setActionLoading(true);
      const distilled = await client.distillSkillFromTrajectory(
        sourceSession,
        newSkillName ? newSkillName : undefined,
      );
      setStatusMessage(`Successfully distilled skill "${distilled.name}" from session.`);
      setNewSkillName("");
      await loadSkills();
      setSelectedSkillId(distilled.id);
    } catch (err) {
      console.error("Distillation failed:", err);
      setStatusMessage(`Distillation failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handlePromote = async (skillId: string) => {
    try {
      setActionLoading(true);
      const res = await client.promoteSkill(skillId);
      setStatusMessage(`Promoted skill to canonical library at ${res.targetPath}`);
      await loadSkills();
    } catch (err) {
      console.error("Promotion failed:", err);
      setStatusMessage(`Promotion failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async (skillId: string) => {
    try {
      setActionLoading(true);
      await client.deleteDistilledSkill(skillId);
      setStatusMessage(`Deleted distilled skill.`);
      await loadSkills();
    } catch (err) {
      console.error("Delete failed:", err);
    } finally {
      setActionLoading(false);
    }
  };

  const selectedSkill = skills.find((s) => s.id === selectedSkillId);

  return (
    <div className="skill-distill-panel" data-testid="skill-distillation-panel">
      <div className="skill-distill-header">
        <div className="skill-distill-header-info">
          <h2>Self-Evolving Skill Distillation Engine (Voyager & Eureka)</h2>
          <p>
            Autonomously extracts verified toolchains and bugfix workflows from agent trajectories into
            reusable skill packages.
          </p>
          <div className="skill-distill-badges">
            <span className="cua-badge active">Voyager Engine: Active</span>
            <span className="cua-badge guard">Target: ~/.skill-library/active</span>
            <span className="cua-badge">Distilled Skills ({skills.length})</span>
          </div>
        </div>
        <div className="cua-header-actions">
          <button type="button" className="cua-btn" onClick={() => void loadSkills()} disabled={loading}>
            Refresh Skills
          </button>
        </div>
      </div>

      {statusMessage && (
        <div className="cua-result-banner" data-testid="skill-status-banner">
          {statusMessage}
        </div>
      )}

      <div className="skill-distill-grid">
        <div className="skill-distill-left">
          <div>
            <div className="cua-section-title">Trajectory Distillation Trigger</div>
            <div className="cua-action-form" style={{ marginBottom: "1rem" }}>
              <div className="cua-form-row">
                <span className="cua-form-label">Session:</span>
                <input
                  type="text"
                  className="cua-input"
                  value={sourceSession}
                  onChange={(e) => setSourceSession(e.target.value)}
                  placeholder="Session ID or trajectory..."
                  data-testid="input-session-id"
                />
              </div>
              <div className="cua-form-row">
                <span className="cua-form-label">Skill Name:</span>
                <input
                  type="text"
                  className="cua-input"
                  value={newSkillName}
                  onChange={(e) => setNewSkillName(e.target.value)}
                  placeholder="Optional custom skill name..."
                  data-testid="input-skill-name"
                />
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  className="cua-btn primary"
                  onClick={() => void handleDistill()}
                  disabled={actionLoading || !sourceSession}
                  data-testid="btn-distill-skill"
                >
                  {actionLoading ? "Distilling..." : "Distill from Trajectory"}
                </button>
              </div>
            </div>

            <div className="cua-section-title">Discovered Skills ({skills.length})</div>
            <div className="cua-window-list" style={{ maxHeight: "240px" }} data-testid="skills-list">
              {skills.map((s) => (
                <div
                  key={s.id}
                  className={`skill-distill-card ${selectedSkillId === s.id ? "selected" : ""}`}
                  onClick={() => setSelectedSkillId(s.id)}
                  data-testid={`skill-card-${s.id}`}
                >
                  <div className="skill-card-top">
                    <span className="skill-card-name">{s.name}</span>
                    <span
                      style={{
                        fontSize: "0.72rem",
                        color: s.isPromoted ? "#34d399" : "#94a3b8",
                        fontFamily: "monospace",
                      }}
                    >
                      {s.isPromoted ? "PROMOTED" : "DRAFT"}
                    </span>
                  </div>
                  <div className="skill-card-desc">{s.description}</div>
                  <div className="skill-triggers-row">
                    {s.triggers.map((t) => (
                      <span key={t} className="skill-trigger-tag">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="skill-distill-right">
          <div className="cua-section-title">
            Skill Package Inspector {selectedSkill ? `— ${selectedSkill.name}` : ""}
          </div>
          {selectedSkill ? (
            <div className="skill-editor-container">
              <div className="skill-stats-badge">
                Success Rate: {(selectedSkill.successRate * 100).toFixed(0)}% • Runs Observed:{" "}
                {selectedSkill.runsObserved} • Created: {selectedSkill.createdAt.slice(0, 10)}
              </div>
              <div className="cua-section-title" style={{ margin: "0.25rem 0" }}>
                SKILL.md Package Definition
              </div>
              <pre className="skill-markdown-preview" data-testid="skill-markdown-preview">
                {selectedSkill.skillMarkdown}
              </pre>

              <div className="skill-actions-row">
                <button
                  type="button"
                  className="cua-btn"
                  style={{ color: "#ef4444" }}
                  onClick={() => void handleDelete(selectedSkill.id)}
                  disabled={actionLoading}
                  data-testid="btn-delete-skill"
                >
                  Delete Skill
                </button>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button
                    type="button"
                    className="cua-btn primary"
                    onClick={() => void handlePromote(selectedSkill.id)}
                    disabled={actionLoading || selectedSkill.isPromoted}
                    data-testid="btn-promote-skill"
                  >
                    {selectedSkill.isPromoted
                      ? "Already in Canonical Library"
                      : "Promote to ~/.skill-library/active"}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ color: "#64748b", padding: "2rem" }}>
              Select a distilled skill to inspect its package.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
