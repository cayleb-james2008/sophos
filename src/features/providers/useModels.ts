// useModels — loads the model/provider catalog and exposes a setModel action.
// The current selection is sourced from live connection state (useConnectionState)
// so it stays in sync with the daemon; the catalog comes from getProviders()/getModels().
// Thinking level is tracked locally and passed to setModel for providers that support it.
//
// P10 (max context + max output): every model defaults to its provider MAX for both
// the context window and max output tokens. Persisted per-model overrides (in settings,
// keyed `${provider}:${model}`) are applied on top, so the in-app adjuster can lower the
// values below the ceiling. setModelConfig() persists + pushes an override to the engine.

import { useCallback, useEffect, useState } from "react";
import { useIpc, isTauri } from "../../ipc/client";
import type { ModelInfo, ModelRuntimeConfig, ProviderInfo, Settings } from "../../ipc/contract";

export const DEFAULT_PROVIDER = "ollama-cloud";
export const DEFAULT_MODEL = "deepseek-v4-flash:0731-cloud";

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

const THINKING_LEVELS: Array<{ value: ThinkingLevel; label: string }> = [
  { value: "off", label: "Off" },
  { value: "minimal", label: "Minimal" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra High" },
  { value: "max", label: "Max" },
];

export interface ModelSelection {
  provider: string;
  model: string;
  thinking?: ThinkingLevel;
}

/** Model key used for per-model runtime overrides. */
export function modelKey(provider: string, model: string): string {
  return `${provider}:${model}`;
}

/**
 * Fallback ceilings when the catalog does not advertise a max. These mirror the
 * REAL engine catalog (~/.prime/agent/models.json + built-ins): ollama-cloud and
 * openrouter deepseek-v4-flash declare contextWindow 1000000 / maxTokens 65536;
 * MiniMax-M3 (built-in) declares contextWindow 524288 / maxTokens 128000. The
 * real bridge reads the daemon catalog first; this table is only a browser-side
 * stand-in so the exercised surface shows real numbers, not invented ones.
 */
const FALLBACK_MAX: Record<string, { contextWindow: number; maxOutputTokens: number }> = {
  "ollama-cloud:deepseek-v4-flash:0731-cloud": { contextWindow: 1000000, maxOutputTokens: 65536 },
  "opencode:deepseek-v4-flash-free": { contextWindow: 1000000, maxOutputTokens: 65536 },
  "minimax:MiniMax-M3": { contextWindow: 524288, maxOutputTokens: 128000 },
};

function asThinkingLevel(value: unknown): ThinkingLevel | undefined {
  return typeof value === "string" && THINKING_LEVELS.some((level) => level.value === value)
    ? value as ThinkingLevel
    : undefined;
}

const DEFAULT_MAX_CONTEXT = 128000;
const DEFAULT_MAX_OUTPUT = 16384;

/**
 * Mock local endpoint model. When a local (Ollama / OpenAI-compatible)
 * provider is connected, this single entry is appended to the catalog so the
 * local card shows a model with reasonable defaults (128k context, 8k output).
 * Only used in browser-demo mode (not Tauri), where the real daemon would
 * report the actual local models.
 */
const LOCAL_MODEL: ModelInfo = {
  id: "local-model",
  name: "Local Model",
  provider: "local",
  contextWindow: 131072,
  maxOutputTokens: 8192,
  maxContextWindow: 131072,
  maxOutputTokensCeiling: 8192,
};

/** Apply overrides + append the mock local model when a local provider is connected. */
function modelsForCatalog(mods: ModelInfo[], overrides: Record<string, ModelRuntimeConfig>, localConnected: boolean): ModelInfo[] {
  const base = mods.map((m) => withEffectiveConfig(m, overrides[modelKey(m.provider, m.id)]));
  if (!localConnected) return base;
  return [...base, withEffectiveConfig(LOCAL_MODEL, overrides[modelKey(LOCAL_MODEL.provider, LOCAL_MODEL.id)])];
}

/** Clamp a token value into [min, max], returning a safe integer. */
function clampToken(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return max;
  return Math.min(max, Math.max(min, Math.round(v)));
}

/** Resolve the provider ceiling for a model (catalog first, then fallback table). */
function ceilingFor(model: ModelInfo): { contextWindow: number; maxOutputTokens: number } {
  const fb = FALLBACK_MAX[modelKey(model.provider, model.id)];
  return {
    contextWindow: model.maxContextWindow ?? fb?.contextWindow ?? DEFAULT_MAX_CONTEXT,
    maxOutputTokens: model.maxOutputTokensCeiling ?? fb?.maxOutputTokens ?? DEFAULT_MAX_OUTPUT,
  };
}

/** Apply a persisted override (or the ceiling default) onto a catalog model. */
function withEffectiveConfig(model: ModelInfo, override?: ModelRuntimeConfig): ModelInfo {
  const ceil = ceilingFor(model);
  const overrideCtx = override?.contextWindow;
  const overrideOut = override?.maxOutputTokens;
  return {
    ...model,
    contextWindow: clampToken(overrideCtx ?? ceil.contextWindow, 1024, ceil.contextWindow),
    maxOutputTokens: clampToken(overrideOut ?? ceil.maxOutputTokens, 1024, ceil.maxOutputTokens),
    maxContextWindow: ceil.contextWindow,
    maxOutputTokensCeiling: ceil.maxOutputTokens,
  };
}

export function useModels() {
  const client = useIpc();
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [thinking, setThinking] = useState<ThinkingLevel>("xhigh");
  const [fastMode, setFastModeState] = useState<boolean>(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [provs, mods, settings] = await Promise.all([
        client.getProviders(),
        client.getModels(),
        client.getSettings().catch(() => undefined),
      ]);
      const overrides = settings?.modelConfig ?? {};
      const savedThinking = asThinkingLevel(settings?.defaultThinking);
      if (savedThinking) setThinking(savedThinking);
      if (typeof settings?.defaultFastMode === "boolean") setFastModeState(settings.defaultFastMode);
      setProviders(provs);
      const localConnected = !isTauri && !!(settings?.localProviders?.length);
      setModels(modelsForCatalog(mods, overrides, localConnected));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    Promise.all([client.getProviders(), client.getModels(), client.getSettings().catch(() => undefined)])
      .then(([provs, mods, settings]) => {
        if (!mounted) return;
        const overrides = settings?.modelConfig ?? {};
        const savedThinking = asThinkingLevel(settings?.defaultThinking);
        if (savedThinking) setThinking(savedThinking);
        if (typeof settings?.defaultFastMode === "boolean") setFastModeState(settings.defaultFastMode);
        setProviders(provs);
        const localConnected = !isTauri && !!(settings?.localProviders?.length);
        setModels(modelsForCatalog(mods, overrides, localConnected));
        setError(null);
      })
      .catch((err) => {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [client]);

  const setModel = useCallback(
    async (provider: string, model: string, thinkingLevel?: ThinkingLevel, _runtime?: ModelRuntimeConfig, fastModeArg?: boolean) => {
      try {
        // Only thread fastMode through when it is explicitly provided (fastModeArg)
        // or the hook's fastMode state is true. This keeps existing callers
        // (ModelSelector's `setModel(provider, model, thinking)`) working
        // unchanged — the trailing args are truly optional and only appended
        // when they have a meaningful value.
        const fm = fastModeArg ?? fastMode;
        if (fm) {
          await client.setModel(provider, model, thinkingLevel, undefined, fm);
        } else {
          await client.setModel(provider, model, thinkingLevel);
        }
      } catch (err) {
        // Surface but don't throw — the UI can show a transient error.
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [client, fastMode],
  );

  /**
   * Update a model's runtime config (context window + max output tokens).
   * Optimistically reflects the change in the local catalog, persists it to
   * settings, and best-effort pushes it to the engine. Graceful offline: if the
   * engine is unreachable the edit still persists and is applied on reconnect.
   */
  const setModelConfig = useCallback(
    async (provider: string, model: string, runtime: ModelRuntimeConfig) => {
      const key = modelKey(provider, model);
      // Optimistic local update so the UI reflects the change immediately.
      setModels((prev) => prev.map((m) => (m.provider === provider && m.id === model ? withEffectiveConfig(m, runtime) : m)));
      setError(null);
      try {
        const settings = await client.getSettings().catch(() => undefined);
        const overrides = { ...(settings?.modelConfig ?? {}) };
        overrides[key] = { ...(overrides[key] ?? {}), ...runtime };
        // Persist for reconnect/offline durability.
        await client.setSettings({ modelConfig: overrides } as Settings).catch(() => undefined);
        // Push to the engine best-effort — if unreachable, the persisted config
        // is applied when it reconnects.
        await client.setModel(provider, model, thinking, runtime).catch(() => undefined);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [client, thinking],
  );

  /** Reset a model's runtime config back to the provider maximum (UI + engine). */
  const resetModelConfig = useCallback(
    async (provider: string, model: string) => {
      const key = modelKey(provider, model);
      // The ceiling is the model's advertised provider max. Resolve it from the
      // current catalog so we can push the exact ceiling back to the engine.
      const modelInfo = models.find((m) => m.provider === provider && m.id === model);
      const ceil = modelInfo
        ? {
            contextWindow: modelInfo.maxContextWindow ?? modelInfo.contextWindow ?? DEFAULT_MAX_CONTEXT,
            maxOutputTokens: modelInfo.maxOutputTokensCeiling ?? modelInfo.maxOutputTokens ?? DEFAULT_MAX_OUTPUT,
          }
        : undefined;
      // Optimistic local update back to the ceiling.
      setModels((prev) => prev.map((m) => (m.provider === provider && m.id === model ? withEffectiveConfig(m, undefined) : m)));
      setError(null);
      try {
        const settings = await client.getSettings().catch(() => undefined);
        const overrides = { ...(settings?.modelConfig ?? {}) };
        // Remove the key entirely so the persisted app config reverts to the max
        // (an empty object would be spread-merged and keep stale values).
        delete overrides[key];
        await client.setSettings({ modelConfig: overrides } as Settings).catch(() => undefined);
        // Restore the ENGINE too: pass the ceiling through the real D1 path (bridge
        // writes the ceiling into ~/.prime/agent/models.json, then setModel reloads
        // the daemon catalog). Passing an empty runtime would skip the models.json
        // write and leave the previously-lowered override active in the engine.
        await client
          .setModel(provider, model, thinking, ceil ?? {})
          .catch(() => undefined);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [client, thinking, models],
  );

  /** Toggle fast-mode: updates state, persists to settings, and pushes to the engine. */
  const setFastMode = useCallback(
    async (value: boolean) => {
      setFastModeState(value);
      try {
        const settings = await client.getSettings().catch(() => undefined);
        await client.setSettings({ ...settings, defaultFastMode: value, fastMode: value } as Settings).catch(() => undefined);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [client],
  );

  return { providers, models, loading, error, reload, setModel, setModelConfig, resetModelConfig, thinking, setThinking, thinkingLevels: THINKING_LEVELS, fastMode, setFastMode };
}
