// CodePanel — the run_code program view (v0.7.1).
//
// A right-side drawer over the conversation with two sections:
//
//   1. TypeScript SDK — the deterministic render of the live tool registry
//      (built-ins + extension/MCP tools + skills from the existing
//      getRuntimeInfo/getExtensions/testMcpServer calls). Same tool set ⇒
//      byte-identical stubs, lexicographic order; unsupported schemas degrade.
//   2. run_code programs — each program the agent ran this session,
//      decomposed into its individual tool-call cards (the same ToolCallCard
//      the chat renders), with every call recorded in the Trajectory log so
//      the run is searchable, resumable, and forkable like any session.
//
// The live-daemon seam stays honest: the SDK renders from whatever the real
// runtime reports; in demo mode programs are simulated (see CHANGELOG/README
// for the sandboxed-runtime limitation).

import { useEffect, useMemo, useRef, useState } from "react";
import { Text, Button, IconButton, Badge, Spinner } from "../../design";
import { useIpc, useConnectionState } from "../../ipc/client";
import { useAppState } from "../../state/AppState";
import { useProfile } from "../profiles/profiles";
import { useTrajectory } from "../trajectory/trajectory";
import { ToolCallCard } from "../chat/ToolCallCard";
import { loadToolRegistry, countByCategory, type ToolRegistryEntry } from "./toolRegistry";
import { renderSdk } from "./sdkRenderer";
import { useCodeRuns, type CodeRun } from "./useCodeRuns";
import "./code.css";

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function categoryLabel(entry: ToolRegistryEntry): string {
  switch (entry.category) {
    case "builtin": return "built-in";
    case "extension": return `extension${entry.source ? ` · ${entry.source}` : ""}`;
    case "mcp": return `mcp${entry.source ? ` · ${entry.source}` : ""}`;
    case "skill": return `skill${entry.source ? ` · ${entry.source}` : ""}`;
    default: return entry.category;
  }
}

export function CodePanel() {
  const { codeOpen, setCodeOpen, setTrajectoryOpen } = useAppState();
  const { selection } = useProfile();
  const { runs } = useCodeRuns();
  const { record } = useTrajectory();
  const ipc = useIpc();
  const conn = useConnectionState();
  const activeSessionId = conn.activeSessionId ?? "session-unknown";

  const [registry, setRegistry] = useState<ToolRegistryEntry[] | null>(null);
  const [registryError, setRegistryError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<number | null>(null);

  // Load the live registry whenever the panel opens (the runtime can change
  // underneath — extensions installed, MCP servers configured, skills
  // discovered). The render stays deterministic per snapshot.
  useEffect(() => {
    if (!codeOpen) return;
    let mounted = true;
    setRegistry(null);
    setRegistryError(null);
    loadToolRegistry(ipc)
      .then((entries) => {
        if (mounted) setRegistry(entries);
      })
      .catch((err) => {
        if (mounted) setRegistryError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      mounted = false;
    };
  }, [codeOpen, ipc]);

  useEffect(() => () => {
    if (copyTimer.current) window.clearTimeout(copyTimer.current);
  }, []);

  const sdkSource = useMemo(() => (registry ? renderSdk(registry) : ""), [registry]);
  const counts = useMemo(() => (registry ? countByCategory(registry) : null), [registry]);

  const sessionRuns = useMemo(() => runs[activeSessionId] ?? [], [runs, activeSessionId]);

  const handleCopy = () => {
    if (!sdkSource) return;
    void navigator.clipboard
      .writeText(sdkSource)
      .then(() => {
        setCopied(true);
        if (copyTimer.current) window.clearTimeout(copyTimer.current);
        copyTimer.current = window.setTimeout(() => setCopied(false), 1600);
      })
      .catch(() => {
        // Clipboard can be unavailable (permissions) — the code stays visible.
      });
  };

  const handleOpenTrajectory = () => {
    setCodeOpen(false);
    record(activeSessionId, { kind: "system", label: "Trajectory", summary: "Opened Trajectory from Code Mode", detail: activeSessionId, source: "code-mode" });
    setTrajectoryOpen(true);
  };

  return (
    <div className={`cm${codeOpen ? " cm--open" : ""}`} aria-hidden={!codeOpen}>
      <div className="cm__backdrop" onClick={() => setCodeOpen(false)} aria-hidden="true" />

      <aside className="cm__drawer" role="dialog" aria-label="Code Mode">
        <header className="cm__header">
          <div className="cm__heading">
            <Text variant="micro" tone="dim" mono uppercase>One program, many tool calls</Text>
            <Text variant="subtitle" weight="semibold">Code Mode</Text>
          </div>
          <div className="cm__header-actions">
            <IconButton title="Open Trajectory" onClick={handleOpenTrajectory} size="sm">⤳</IconButton>
            <IconButton title="Close Code Mode" onClick={() => setCodeOpen(false)} size="sm">✕</IconButton>
          </div>
        </header>

        <div className="cm__body">
          {/* --- TypeScript SDK section --- */}
          <section className="cm__section">
            <div className="cm__section-head">
              <Text variant="micro" tone="dim" mono uppercase>TypeScript SDK</Text>
              {registry ? (
                <Button variant="ghost" size="sm" onClick={handleCopy} title="Copy the generated SDK">
                  {copied ? "copied" : "copy"}
                </Button>
              ) : null}
            </div>
            <div className="cm__section-meta">
              <Text variant="micro" tone="muted">
                {registry
                  ? `${registry.length} tools · ${counts?.builtin ?? 0} built-in · ${counts?.extension ?? 0} extension · ${counts?.mcp ?? 0} mcp · ${counts?.skill ?? 0} skill`
                  : "Loading the live tool registry…"}
              </Text>
            </div>
            <div className="cm__sdk">
              {registryError ? (
                <Text variant="micro" tone="danger">{registryError}</Text>
              ) : registry ? (
                <pre className="cm__sdk-code" data-testid="sdk-source">{sdkSource}</pre>
              ) : (
                <div className="cm__sdk-loading" aria-busy="true" aria-live="polite">
                  <Spinner size={14} />
                </div>
              )}
            </div>
            <div className="cm__toolindex">
              {registry ? (
                registry.map((entry) => (
                  <span key={`${entry.category}:${entry.name}`} className="cm__toolchip" title={`${entry.description ?? "No description"} — ${categoryLabel(entry)}`}>
                    {entry.name}
                    <span className="cm__toolchip-cat">{entry.category}</span>
                  </span>
                ))
              ) : null}
            </div>
          </section>

          {/* --- run_code programs section --- */}
          <section className="cm__section">
            <div className="cm__section-head">
              <Text variant="micro" tone="dim" mono uppercase>run_code programs</Text>
              <Badge tone="neutral">{sessionRuns.length}</Badge>
            </div>
            <div className="cm__section-meta">
              <Text variant="micro" tone="muted">
                {selection.mode === "code" ? "Programs decompose into individual tool-call cards — every call lands in the Trajectory log." : "Select the Code mode from the header profile chip, then send a prompt to run a program."}
              </Text>
            </div>

            {sessionRuns.length === 0 ? (
              <div className="cm__empty">
                <Text variant="label" tone="muted">
                  No run_code programs yet. Pick the Code profile in the header, then send a message — the simulated program will decompose here and in the Trajectory.
                </Text>
              </div>
            ) : (
              <div className="cm__runs">
                {sessionRuns.map((run) => (
                  <RunCard key={run.id} run={run} />
                ))}
              </div>
            )}
          </section>
        </div>

        <footer className="cm__footer">
          <Text variant="micro" tone="dim">
            The SDK is a typed declaration of the agent's tool contract, rendered deterministically from the live registry. In demo mode programs are simulated — a sandboxed TypeScript runtime on the live daemon is a known limitation (CHANGELOG/README).
          </Text>
        </footer>
      </aside>
    </div>
  );
}

function RunCard({ run }: { run: CodeRun }) {
  return (
    <div className="cm__run" data-testid="code-run">
      <div className="cm__run-head">
        <Badge tone={run.status === "complete" ? "success" : run.status === "error" ? "danger" : "info"} dot>
          {run.status}
        </Badge>
        <Text variant="micro" tone="dim" mono>{formatTime(run.createdAt)}</Text>
        <Text variant="micro" tone="dim" className="cm__run-count">
          {run.calls.length} call{run.calls.length === 1 ? "" : "s"}
        </Text>
      </div>
      <details className="cm__run-program">
        <summary>program</summary>
        <pre className="cm__run-program-code">{run.program}</pre>
      </details>
      <div className="cm__run-calls">
        {run.calls.map((call, index) => (
          <ToolCallCard
            key={`${run.id}-${index}`}
            call={{
              id: `${run.id}-${index}`,
              name: call.name,
              input: call.input,
              output: call.output,
              status: call.status,
            }}
          />
        ))}
      </div>
    </div>
  );
}

