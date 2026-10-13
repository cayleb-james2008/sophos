import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Input, Text } from "../../design";
import { isDemoMode, useIpc } from "../../ipc/client";
import type {
  HarnessEntry,
  HarnessState,
  MemoryState,
  MemoryTier,
  MemoryTierEntry,
  TokenBudgetBreakdown,
} from "../../ipc/contract";
import { RefreshIcon, XIcon } from "../sessions/icons";
import { SearchIcon } from "../../shell/icons";
import "./longrunning.css";

const kinds: Array<HarnessEntry["kind"]> = ["memory", "prompt", "skill", "subagent"];
const memoryTiers: MemoryTier[] = ["working", "recall", "archival"];

export function HarnessStatePanel() {
  const ipc = useIpc();
  const [viewMode, setViewMode] = useState<"continual" | "memory" | "budget">("continual");
  const [state, setState] = useState<HarnessState>();
  const [memoryState, setMemoryState] = useState<MemoryState>();
  const [tokenBudget, setTokenBudget] = useState<TokenBudgetBreakdown>();
  const [compacting, setCompacting] = useState<boolean>(false);
  const [compactionNotice, setCompactionNotice] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [filter, setFilter] = useState<"all" | HarnessEntry["kind"]>("all");
  const [tierFilter, setTierFilter] = useState<"all" | MemoryTier>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<MemoryTierEntry[] | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const hPromise =
        typeof ipc.getHarnessState === "function" ? ipc.getHarnessState() : Promise.resolve(undefined);
      const mPromise =
        isDemoMode() && typeof ipc.getMemoryState === "function"
          ? ipc.getMemoryState().catch(() => undefined)
          : Promise.resolve(undefined);
      const bPromise =
        typeof ipc.getTokenBudget === "function"
          ? ipc.getTokenBudget().catch(() => undefined)
          : Promise.resolve(undefined);
      const [hState, mState, bState] = await Promise.all([hPromise, mPromise, bPromise]);
      setState(hState);
      setMemoryState(mState);
      setTokenBudget(bState);
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Continual harness state unavailable");
    } finally {
      setLoading(false);
    }
  }, [ipc]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const rollback = async (id: string) => {
    try {
      await ipc.prompt(`/refine rollback ${id}`, { queueIfBusy: true, streamingBehavior: "followUp" });
      window.setTimeout(() => void refresh(), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rollback request failed");
    }
  };

  const handleSearchMemory = async () => {
    if (!searchQuery.trim() || typeof ipc.searchMemory !== "function") {
      setSearchResults(null);
      return;
    }
    try {
      const results = await ipc.searchMemory(
        searchQuery.trim(),
        tierFilter === "all" ? undefined : tierFilter,
      );
      setSearchResults(results);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Memory search failed");
    }
  };

  const entries = (state?.entries ?? []).filter((entry) => filter === "all" || entry.kind === filter);

  const rawMemoryEntries = [
    ...(memoryState?.working ?? []),
    ...(memoryState?.recall ?? []),
    ...(memoryState?.archival ?? []),
  ];

  const memoryDisplayEntries =
    searchResults ??
    (tierFilter === "all" ? rawMemoryEntries : rawMemoryEntries.filter((m) => m.tier === tierFilter));

  return (
    <Card variant="raised" padding="lg" className="card-stack-lg">
      <div className="lr-headrow">
        <div>
          <Text variant="label" weight="semibold">
            {isDemoMode() ? "Continual harness & memory architecture" : "Session context"}
          </Text>
          <Text variant="micro" tone="dim" mono className="lr-harness-sub">
            {state?.source ?? (isDemoMode() ? "OpenViking & daemon-owned state" : "Daemon state unavailable")}
          </Text>
        </div>
        <div className="lr-row">
          <Button
            variant={viewMode === "continual" ? "accent-soft" : "ghost"}
            size="sm"
            onClick={() => setViewMode("continual")}
          >
            Harness state
          </Button>
          {isDemoMode() ? (
            <Button
              variant={viewMode === "memory" ? "accent-soft" : "ghost"}
              size="sm"
              onClick={() => setViewMode("memory")}
            >
              Semantic memory tiers ({memoryState?.totalCount ?? rawMemoryEntries.length})
            </Button>
          ) : null}
          <Button
            variant={viewMode === "budget" ? "accent-soft" : "ghost"}
            size="sm"
            onClick={() => setViewMode("budget")}
          >
            Token budget & compaction
          </Button>
          <Button variant="ghost" size="sm" icon={<RefreshIcon size={13} />} onClick={() => void refresh()}>
            Reload
          </Button>
        </div>
      </div>

      {viewMode === "continual" ? (
        <>
          <Text variant="body" tone="muted">
            Daemon prompt, memory, skill and subagent entries. Rollback is sent through the daemon's
            refinement command.
          </Text>
          {error ? (
            <Text variant="micro" tone="danger">
              {error}
            </Text>
          ) : null}

          <div className="lr-row lr-row--wrap">
            <Button
              variant={filter === "all" ? "accent-soft" : "ghost"}
              size="sm"
              onClick={() => setFilter("all")}
            >
              All · {state?.entries.length ?? 0}
            </Button>
            {kinds.map((kind) => (
              <Button
                key={kind}
                variant={filter === kind ? "accent-soft" : "ghost"}
                size="sm"
                onClick={() => setFilter(kind)}
              >
                {kind} · {state?.entries.filter((entry) => entry.kind === kind).length ?? 0}
              </Button>
            ))}
          </div>

          {loading && !state ? (
            <Text variant="body" tone="dim">
              Reading continual harness state from the live daemon…
            </Text>
          ) : null}
          {!loading && entries.length === 0 ? (
            <Text variant="body" tone="dim">
              No saved entries in this scope yet.
            </Text>
          ) : null}
          <div className="lr-list">
            {entries.map((entry) => (
              <div key={`${entry.scope ?? "global"}:${entry.kind}:${entry.id}`} className="lr-harness-entry">
                <div className="lr-row">
                  <Text variant="label" weight="medium">
                    {entry.title}
                  </Text>
                  <Badge tone={entry.scope === "local" ? "info" : "neutral"}>{entry.scope ?? "global"}</Badge>
                  <Badge tone="accent">{entry.kind}</Badge>
                  {entry.version ? (
                    <Text variant="micro" tone="dim" mono>
                      v{entry.version}
                    </Text>
                  ) : null}
                </div>
                <Text variant="body" tone="muted" className="lr-harness-content">
                  {entry.content}
                </Text>
                {entry.kind === "skill" && entry.reference ? (
                  <Text variant="micro" tone="dim" mono>
                    reference {JSON.stringify(entry.reference)}
                  </Text>
                ) : null}
                {entry.path ? (
                  <Text variant="micro" tone="dim" mono className="lr-harness-path">
                    {entry.path}
                  </Text>
                ) : null}
              </div>
            ))}
          </div>

          <div className="lr-section">
            <div className="lr-headrow">
              <Text variant="micro" tone="dim" uppercase>
                Refinement / rollback history
              </Text>
              <Badge tone="neutral">{state?.refinements.length ?? 0}</Badge>
            </div>
            {state?.refinements.length ? (
              state.refinements
                .slice()
                .reverse()
                .map((refinement) => (
                  <div key={refinement.id} className="lr-harness-ref">
                    <div className="lr-harness-refmain">
                      <Text variant="label" className="lr-harness-refsum">
                        {refinement.summary ?? refinement.trigger ?? refinement.id}
                      </Text>
                      <Text variant="micro" tone="dim" mono>
                        {refinement.timestamp ?? refinement.id}
                        {refinement.rollbackOf ? ` · rollback of ${refinement.rollbackOf}` : ""}
                      </Text>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<XIcon size={12} />}
                      onClick={() => void rollback(refinement.id)}
                      title="Request rollback"
                    >
                      Rollback
                    </Button>
                  </div>
                ))
            ) : (
              <Text variant="body" tone="dim">
                No daemon refinement records yet.
              </Text>
            )}
          </div>
        </>
      ) : viewMode === "memory" ? (
        <>
          <Text variant="body" tone="muted">
            3-tier semantic memory architecture (Working scratchpad ↔ Recall conversation buffer ↔ Archival
            OpenViking store) with bi-temporal validity tags and URI indexing.
          </Text>
          <div className="lr-row">
            <Input
              placeholder="Search semantic memory by keyword or URI…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void handleSearchMemory()}
              prefix={<SearchIcon size={13} />}
            />
            <Button variant="outline" size="sm" onClick={() => void handleSearchMemory()}>
              Search
            </Button>
            {searchResults ? (
              <Button variant="ghost" size="sm" onClick={() => setSearchResults(null)}>
                Clear filter
              </Button>
            ) : null}
          </div>

          <div className="lr-row lr-row--wrap">
            <Button
              variant={tierFilter === "all" ? "accent-soft" : "ghost"}
              size="sm"
              onClick={() => {
                setTierFilter("all");
                setSearchResults(null);
              }}
            >
              All tiers · {rawMemoryEntries.length}
            </Button>
            {memoryTiers.map((tier) => (
              <Button
                key={tier}
                variant={tierFilter === tier ? "accent-soft" : "ghost"}
                size="sm"
                onClick={() => {
                  setTierFilter(tier);
                  setSearchResults(null);
                }}
              >
                {tier} · {rawMemoryEntries.filter((m) => m.tier === tier).length}
              </Button>
            ))}
          </div>

          {memoryDisplayEntries.length === 0 ? (
            <Text variant="body" tone="dim">
              No memory records found in this tier.
            </Text>
          ) : (
            <div className="lr-list">
              {memoryDisplayEntries.map((mem) => (
                <div key={mem.id} className="lr-harness-entry">
                  <div className="lr-row">
                    <Text variant="label" weight="medium">
                      {mem.title}
                    </Text>
                    <Badge
                      tone={mem.tier === "archival" ? "accent" : mem.tier === "recall" ? "warning" : "info"}
                    >
                      {mem.tier}
                    </Badge>
                    {mem.confidence != null ? (
                      <Badge tone="neutral">{(mem.confidence * 100).toFixed(0)}% confidence</Badge>
                    ) : null}
                    {mem.scope ? <Badge tone="neutral">{mem.scope}</Badge> : null}
                  </div>
                  <Text variant="body" tone="muted" className="lr-harness-content">
                    {mem.content}
                  </Text>
                  <div className="lr-row lr-row--wrap">
                    {mem.uri ? (
                      <Text variant="micro" tone="accent" mono className="lr-harness-path">
                        {mem.uri}
                      </Text>
                    ) : null}
                    {mem.temporalValidity?.assertedAt ? (
                      <Text variant="micro" tone="dim" mono>
                        asserted: {new Date(mem.temporalValidity.assertedAt).toLocaleTimeString()}
                      </Text>
                    ) : null}
                    {mem.tags?.map((t) => (
                      <Badge key={t} tone="neutral">
                        #{t}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        /* Token Budget & Context Compaction Optimizer View */
        <div className="card-stack" data-testid="token-budget-panel">
          <Text variant="body" tone="muted">
            View the daemon’s measured context usage and summarize the active conversation.
          </Text>

          {compactionNotice && (
            <div
              className="sp-test"
              style={{ padding: "8px 12px", borderRadius: "6px", background: "var(--color-surface-sunken)" }}
            >
              <Text variant="micro" tone="muted">
                {compactionNotice}
              </Text>
            </div>
          )}

          {tokenBudget && (
            <>
              {/* Main Progress Bar */}
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", margin: "8px 0" }}>
                <div className="lr-headrow">
                  <Text variant="label" weight="semibold">
                    Context Window Usage: {tokenBudget.totalTokens.toLocaleString()} /{" "}
                    {tokenBudget.contextLimit.toLocaleString()} tokens
                  </Text>
                  <Badge
                    tone={
                      tokenBudget.usagePercent > 80
                        ? "danger"
                        : tokenBudget.usagePercent > 50
                          ? "accent"
                          : "success"
                    }
                  >
                    {tokenBudget.usagePercent}% Used
                  </Badge>
                </div>
                <div
                  style={{
                    width: "100%",
                    height: "10px",
                    background: "var(--color-surface-sunken)",
                    borderRadius: "5px",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${Math.min(100, tokenBudget.usagePercent)}%`,
                      height: "100%",
                      background:
                        tokenBudget.usagePercent > 80
                          ? "var(--color-danger)"
                          : tokenBudget.usagePercent > 50
                            ? "var(--color-accent)"
                            : "var(--color-success)",
                      transition: "width 0.3s ease",
                    }}
                  />
                </div>
              </div>

              {tokenBudget.tiers ? (
                <>
                  {/* Tiers Distribution */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                      gap: "10px",
                    }}
                  >
                    <Card variant="default" padding="sm">
                      <Text variant="micro" tone="dim" uppercase weight="semibold">
                        Chat Transcript
                      </Text>
                      <Text variant="label" weight="bold">
                        {tokenBudget.tiers.chatHistory.toLocaleString()} tokens
                      </Text>
                    </Card>
                    <Card variant="default" padding="sm">
                      <Text variant="micro" tone="dim" uppercase weight="semibold">
                        Tools & Schemas
                      </Text>
                      <Text variant="label" weight="bold">
                        {tokenBudget.tiers.toolsAndSchemas.toLocaleString()} tokens
                      </Text>
                    </Card>
                    <Card variant="default" padding="sm">
                      <Text variant="micro" tone="dim" uppercase weight="semibold">
                        Working Memory
                      </Text>
                      <Text variant="label" weight="bold">
                        {tokenBudget.tiers.workingMemory.toLocaleString()} tokens
                      </Text>
                    </Card>
                    <Card variant="default" padding="sm">
                      <Text variant="micro" tone="dim" uppercase weight="semibold">
                        System Prompt
                      </Text>
                      <Text variant="label" weight="bold">
                        {tokenBudget.tiers.systemPrompt.toLocaleString()} tokens
                      </Text>
                    </Card>
                    <Card variant="default" padding="sm">
                      <Text variant="micro" tone="dim" uppercase weight="semibold">
                        Semantic Archival
                      </Text>
                      <Text variant="label" weight="bold">
                        {tokenBudget.tiers.semanticArchival.toLocaleString()} tokens
                      </Text>
                    </Card>
                    <Card variant="default" padding="sm">
                      <Text variant="micro" tone="dim" uppercase weight="semibold">
                        Checkpoints
                      </Text>
                      <Text variant="label" weight="bold">
                        {tokenBudget.tiers.checkpoints.toLocaleString()} tokens
                      </Text>
                    </Card>
                  </div>
                </>
              ) : null}

              {/* Compaction Actions */}
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "12px" }}>
                <Text variant="label" weight="semibold">
                  Context compaction
                </Text>
                <div className="lr-row lr-row--wrap">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={compacting}
                    onClick={async () => {
                      setCompacting(true);
                      try {
                        const res = await ipc.compactContext("semantic-summarize");
                        setCompactionNotice(
                          res.savedTokens == null
                            ? "Context summarized. Token usage updates after the next model response."
                            : `Context summarized; ${res.savedTokens.toLocaleString()} tokens reclaimed.`,
                        );
                        void refresh();
                      } catch (err) {
                        setCompactionNotice(err instanceof Error ? err.message : "Compaction failed.");
                      } finally {
                        setCompacting(false);
                      }
                    }}
                  >
                    Summarize Context
                  </Button>
                  {isDemoMode() ? (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={compacting}
                        onClick={async () => {
                          setCompacting(true);
                          try {
                            const res = await ipc.compactContext("prune-oldest");
                            setCompactionNotice(
                              `Pruned oldest conversation turns, saving ${res.savedTokens?.toLocaleString() ?? "unavailable"} tokens!`,
                            );
                            void refresh();
                          } finally {
                            setCompacting(false);
                          }
                        }}
                      >
                        Prune Oldest Turns
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={compacting}
                        onClick={async () => {
                          setCompacting(true);
                          try {
                            const res = await ipc.compactContext("evict-tools");
                            setCompactionNotice(
                              `Evicted dormant tool schemas, saving ${res.savedTokens?.toLocaleString() ?? "unavailable"} tokens!`,
                            );
                            void refresh();
                          } finally {
                            setCompacting(false);
                          }
                        }}
                      >
                        Evict Dormant Tools
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  );
}
