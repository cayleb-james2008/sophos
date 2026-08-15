// SubagentPolicyPanel — the persistent default model policy for RLM
// subagents. Lets the operator pin the provider, model, and thinking level
// that new child agents inherit. Values persist across sessions via
// setSettings (the Settings interface already carries arbitrary fields, so no
// new IPC methods are needed) and are surfaced to AgentComposer as the
// per-child composition defaults.
//
// Handles the full data lifecycle: a loading skeleton while the catalog and
// saved policy are fetched, a clear error state with retry when the IPC layer
// is unreachable, and a helpful empty state when no providers exist.

import { useCallback, useEffect, useState } from "react";
import { Text, Card, Select, Badge, Skeleton, Button } from "../../design";
import { useIpc } from "../../ipc/client";
import { useModels } from "../providers/useModels";
import type { Settings } from "../../ipc/contract";

const THINKING_OPTIONS = [
  { value: "none", label: "None" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

export function SubagentPolicyPanel() {
  const ipc = useIpc();
  const { providers, models, loading } = useModels();
  const [draft, setDraft] = useState<Settings>({});
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setError(undefined);
    try {
      const s = await ipc.getSettings();
      setDraft(s);
      setLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load settings");
      setLoaded(true);
    }
  }, [ipc]);

  useEffect(() => {
    void load();
  }, [load]);

  const provider = draft.subagentDefaultProvider ?? "";
  const model = draft.subagentDefaultModel ?? "";
  const thinking = draft.subagentDefaultThinking ?? "medium";

  // Models for the currently selected provider.
  const modelsForProvider = models.filter((m) => m.provider === provider);

  const persist = useCallback(
    async (patch: Partial<Settings>) => {
      setDraft((d) => ({ ...d, ...patch }));
      setSaved(false);
      setError(undefined);
      try {
        await ipc.setSettings({ ...draft, ...patch } as Settings);
        setSaved(true);
        window.setTimeout(() => setSaved(false), 1800);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save policy");
      }
    },
    [ipc, draft],
  );

  const isLoading = loading || !loaded;

  return (
    <Card variant="raised" padding="lg" className="card-stack">
      <div className="sp-head">
        <div className="sp-headleft">
          <span className="sp-icon sp-icon--dim">⌗</span>
          <div className="sp-headrow">
            <Text variant="label" weight="semibold">
              Subagent model policy
            </Text>
            <Text variant="micro" tone="dim">
              Default provider, model &amp; thinking for new RLM subagents
            </Text>
          </div>
        </div>
        {saved ? <Badge tone="success" dot>Saved</Badge> : <Badge tone="neutral">Persists</Badge>}
      </div>

      {isLoading ? (
        <div className="sub-skeleton" aria-busy="true">
          <Skeleton width="100%" height={34} />
          <Skeleton width="100%" height={34} />
          <Skeleton width="100%" height={34} />
        </div>
      ) : error && !provider && !model ? (
        <div className="sub-error" role="alert">
          <Text variant="body" tone="danger">{error}</Text>
          <div className="sub-error__actions">
            <Button variant="outline" size="sm" onClick={() => void load()}>Retry</Button>
          </div>
        </div>
      ) : !providers.length ? (
        <div className="sub-empty">
          <Text variant="body" tone="muted">
            No providers configured. Connect a provider on the Providers tab, then set a
            default model for your subagents.
          </Text>
        </div>
      ) : (
        <div className="sub-grid">
          <div className="sub-field">
            <Select
              label="Provider"
              value={provider}
              onChange={(e) => void persist({ subagentDefaultProvider: e.target.value })}
              options={providers.map((p) => ({ value: p.id, label: p.name }))}
            />
            <Text variant="micro" tone="dim">Provider that new subagents use by default</Text>
          </div>
          <div className="sub-field">
            <Select
              label="Model"
              value={model}
              onChange={(e) => void persist({ subagentDefaultModel: e.target.value })}
              options={modelsForProvider.map((m) => ({ value: m.id, label: m.name ?? m.id }))}
            />
            <Text variant="micro" tone="dim">
              {modelsForProvider.length
                ? "Model for new subagents on this provider"
                : "No models reported for this provider — check the Providers tab"}
            </Text>
          </div>
          <div className="sub-field sub-grid--wide">
            <Select
              label="Thinking level"
              value={thinking}
              onChange={(e) => void persist({ subagentDefaultThinking: e.target.value })}
              options={THINKING_OPTIONS}
            />
            <Text variant="micro" tone="dim">Reasoning effort inherited by new subagents</Text>
          </div>
        </div>
      )}

      {error && provider && model ? (
        <Text variant="micro" tone="danger">{error}</Text>
      ) : null}
    </Card>
  );
}
