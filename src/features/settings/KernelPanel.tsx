import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, Card, Text, TextArea } from "../../design";
import { useIpc, useIpcEvent } from "../../ipc/client";
import type { KernelHealthDiagnostic, KernelState } from "../../ipc/contract";
import { CpuIcon, RefreshIcon } from "../sessions/icons";

const STARTING_DIAGNOSTIC: KernelHealthDiagnostic = {
  reason: "starting",
  message: "The Python workspace is starting.",
  nextStep: "Wait a few seconds, then refresh this panel.",
  action: "wait",
};
const READ_FAILURE_DIAGNOSTIC: KernelHealthDiagnostic = {
  reason: "unavailable",
  message: "Kernel health is temporarily unavailable.",
  nextStep: "Check the engine connection, then refresh this panel.",
  action: "refresh",
};

export function KernelPanel() {
  const ipc = useIpc();
  const [kernel, setKernel] = useState<KernelState>();
  const [code, setCode] = useState("x = 1\nprint(x)");
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string>();
  const refreshInFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    setLoading(true);
    try {
      setKernel(await ipc.getKernelState());
      setError(undefined);
    } catch {
      setKernel((current) => current ? { ...current, status: "unavailable", diagnostic: READ_FAILURE_DIAGNOSTIC } : current);
      setError("Kernel health could not be read. Check the engine connection, then refresh this panel.");
    } finally {
      refreshInFlight.current = false;
      setLoading(false);
    }
  }, [ipc]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useIpcEvent((event) => {
    if (event.type === "session_event") {
      const kind = event.event.kind;
      if (kind === "tool_call" || kind === "tool_result" || kind === "message" || kind === "resynced") {
        void refresh();
      }
    }
  });

  const runCell = async () => {
    const cell = code.trim();
    if (!cell || running) return;
    setRunning(true);
    setError(undefined);
    try {
      await ipc.prompt(
        "Use the persistent IPython kernel. Execute exactly this user-supplied code cell and do not rewrite or merely describe it:\n\n" + cell,
        { queueIfBusy: true, streamingBehavior: "followUp" },
      );
      window.setTimeout(() => void refresh(), 800);
    } catch {
      setError("The code cell could not be started. Check the kernel health message above, then try again.");
    } finally {
      setRunning(false);
    }
  };

  const status = kernel?.status ?? "unavailable";
  const diagnostic = kernel?.diagnostic ?? (loading ? STARTING_DIAGNOSTIC : READ_FAILURE_DIAGNOSTIC);
  const statusTone = status === "running" ? "info" : status === "configured" ? "success" : status === "browser-preview" ? "neutral" : "warning";

  return (
    <Card variant="raised" padding="lg" style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <div className="sp-head">
        <div className="sp-headrow--sm">
          <CpuIcon size={16} />
          <Text variant="label" weight="semibold">Persistent IPython notebook</Text>
          <Badge tone={statusTone} dot>{status}</Badge>
        </div>
        <Button variant="ghost" size="sm" icon={<RefreshIcon size={13} />} onClick={() => void refresh()}>Refresh</Button>
      </div>
      <Text variant="micro" tone="dim">
        This is the daemon-backed IPython state: execution counts and cell results come from real kernel/tool metadata, while names and imports come from the live namespace. The kernel is persistent and is not a security sandbox.
      </Text>
      <div role="status" className="kp-diag">
        <Text variant="micro" weight="semibold">{diagnostic.message}</Text>
        <Text variant="micro" tone="dim">Next step: {diagnostic.nextStep}</Text>
      </div>
      {error ? <Text variant="micro" tone="danger">{error}</Text> : null}

      <div className="kp-grid2">
        <StateList label="Variables" values={kernel?.variables ?? []} empty="No live names reported yet." />
        <StateList label="Imports" values={kernel?.imports ?? []} empty="No live module imports reported yet." />
      </div>
      <div className="kp-execcol">
        <Text variant="micro" tone="dim">Last execution count: {kernel?.executionCount ?? "—"}</Text>
        {kernel?.lastOutput ? <pre className="kp-pre kp-pre--dim">{kernel.lastOutput}</pre> : null}
        {kernel?.lastError ? <Text variant="micro" tone="danger">{kernel.lastError}</Text> : null}
      </div>

      <div className="kp-run">
        <Text variant="micro" tone="dim" uppercase>Run a code cell</Text>
        <TextArea value={code} onChange={(event) => setCode(event.target.value)} placeholder="x = 42\nprint(x)" rows={5} />
        <div className="kp-runfoot">
          <Button variant="accent-soft" onClick={() => void runCell()} loading={running}>Execute in kernel</Button>
        </div>
      </div>

      <div className="kp-hist">
        <Text variant="micro" tone="dim" uppercase>Cell history · {kernel?.cells.length ?? 0}</Text>
        {(kernel?.cells.length ?? 0) === 0 ? (
          <Text variant="body" tone="dim">No IPython cells have been reported for this session.</Text>
        ) : (
          kernel!.cells.slice().reverse().map((cell) => (
            <div key={cell.id} className="kp-cell">
              <div className="sp-head">
                <Text variant="micro" tone="dim" mono>In [{cell.executionCount ?? "—"}] · {cell.id}</Text>
                <Badge tone={cell.status === "ok" ? "success" : cell.status === "error" ? "danger" : "info"} dot>{cell.status}</Badge>
              </div>
              <pre className="kp-pre">{cell.code}</pre>
              {cell.output ? <pre className="kp-pre kp-pre--dim">{cell.output}</pre> : null}
              {cell.error ? <Text variant="micro" tone="danger">{cell.error}</Text> : null}
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

function StateList({ label, values, empty }: { label: string; values: string[]; empty: string }) {
  return (
    <div className="kp-stat">
      <Text variant="micro" tone="dim" uppercase>{label} · {values.length}</Text>
      {values.length ? <Text variant="label" mono>{values.join(", ")}</Text> : <Text variant="micro" tone="dim">{empty}</Text>}
    </div>
  );
}
