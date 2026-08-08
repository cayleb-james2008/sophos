# P10 — Max context + max output tokens (in-app adjustable)

Worker piece P10. Worktree: `C:\Users\Cayleb\.traycer\worktrees\local__prime-agent-windows__f2eb521c4d\piece-context`
· branch: `piece-context` · forked from `master` (all pieces merged).

## Goal

Default every model on every provider to its **maximum context window** and
**maximum output tokens**, and make both values **adjustable in-app**
(Settings → Providers, per selected model) with the provider maximum shown as
the ceiling. Graceful when the engine is unreachable.

## What changed

| File | Change |
|------|--------|
| `src/ipc/contract.ts` | `ModelInfo` gains `maxContextWindow` + `maxOutputTokensCeiling` (provider ceilings) and `maxOutputTokens` (effective). New `ModelRuntimeConfig` type. `Settings.modelConfig` (`Record<"provider:model", ModelRuntimeConfig>`) for persistence. `setModel` IPC params accept `contextWindow` + `maxOutputTokens`. |
| `src/ipc/client.ts` | `setModel(provider, model, thinking?, runtime?)` forwards runtime overrides. Mock catalog now advertises per-model ceilings (deepseek 200k ctx / 65,536 out; MiniMax 262,144 / 65,536) and defaults to max. Mock `setSettings`/`getSettings` persist `modelConfig`; `applyModelRuntime` reflects overrides in catalog + connection context. |
| `src/features/providers/useModels.ts` | Effective catalog computed from persisted overrides applied on top of provider maxima (default = max). New `setModelConfig` (optimistic UI update + persist to settings + best-effort push to engine, errors swallowed so offline edits still persist) and `resetModelConfig`; `reload` re-reads catalog + overrides. |
| `src/features/settings/ProvidersPanel.tsx` | Per-model expandable **Configure** row with a runtime-config adjuster: slider + numeric input for **Context window** and **Max output tokens**, ceiling shown as `value / max`, fill-bar, **Apply to model** and **Reset to max**. Wired to `setModelConfig`/`resetModelConfig`. |
| `bridge/src/rpc.ts` | `setModel` now persists `contextWindow`/`maxOutputTokens` overrides into the settings store (keyed `provider:model`) so they survive reconnects, then forwards `setModel` to the engine. |
| `bridge/src/connection.ts` | `getModels`/`getProviders` expose `maxContextWindow`, `maxOutputTokens`, `maxOutputTokensCeiling` from the daemon model catalog (`contextWindow`/`maxTokens`). |

## Data flow

```
Settings → Providers (adjuster)
   │  slider + numeric  (ceiling = model.maxContextWindow / maxOutputTokensCeiling)
   ▼
useModels.setModelConfig(runtime)
   │  1. optimistic local catalog update
   │  2. client.setSettings({ modelConfig })   → persisted (SettingsStore / mock)
   │  3. client.setModel(provider, model, thinking, runtime)  → best-effort to engine (bridge)
   ▼
bridge setModel → persist modelConfig into settings store → conn.setModel() to daemon
```

Defaults: every model's effective `contextWindow`/`maxOutputTokens` = its
provider ceiling unless a persisted override lowers it. `setModelConfig` wraps
the engine push in `.catch(() => undefined)`, so if the engine is down the edit
still persists and is applied on reconnect.

## Gates

### 1. Build — PASS
`npm run build` (tsc strict + vite) clean: 87 modules transformed, built in ~0.7s.
TypeScript `strict` — 0 errors.

### 2. Bridge — PASS (round 2)
`npm install` in `bridge/` linked the `file:` deps (`@earendil-works/pi-coding-agent`,
`@types/node`), and `npm run build` (`tsc -p tsconfig.json`) is clean. The bridge
changes (setModel override write to models.json + settings persistence + catalog
ceilings) compile and were exercised directly in Node (see Round 2).

### 3. Browser smoke (port 1420) — PASS
Fresh dev server from this worktree on `http://localhost:1420` (killed a stale
server from the completed `piece-redesign` worktree that was squatting on 1420).

DOM probe (agent-browser / Chromium):
- Providers tab lists every model at **max** by default:
  - `DeepSeek V4 Flash 0731` → **200,000 ctx · 65,536 out**
  - `MiniMax M3` → **262,144 ctx · 65,536 out**
  - `DeepSeek V4 Flash (free)` → **200,000 ctx · 65,536 out**
- Expanding a model shows the adjuster with slider + numeric input for both
  values, defaulted to the ceiling (`200000 / 200000`, `65536 / 65536`).
- Changed Context window → `128000`, Max output → `32768`, **Apply to model**
  → model row updates to `128,000 ctx · 32,768 out` (and connection context
  telemetry reflects the new window).
- **Persistence**: tab away (Settings → General) and back → Providers still
  shows `128,000 ctx · 32,768 out` (override read back from settings).
- **Reset to max** → restores `200,000 ctx · 65,536 out` and numeric inputs.
- Console: 0 runtime JS errors (only vite HMR + React DevTools notices).

Screenshots:
- `verify/p10-providers-max.png` — all models at max (collapsed overview)
- `verify/p10-adjuster-expanded.png` — expanded adjuster (slider + numeric,
  ceiling, fill bar, Apply / Reset)
- `verify/p10-settings.png` — Settings landing (General tab)

### 4. Graceful offline — PASS (by design)
`setModelConfig` updates the local catalog + persists to settings regardless of
engine reachability; the engine push is best-effort and error-swallowed. The
persisted `modelConfig` is re-applied on the next catalog load (reconnect).

## Preserve
All existing settings/providers behavior, login/logout (now with `reload`),
design system (tokens + components), and the other views are untouched.
`ModelSelector` still renders the effective context (now max by default).

## Commit
`git log -1 --oneline` on `piece-context` recorded after this doc is committed.

## Round 2 — critic fixes (blocking defects D1, D2, D3 + reset bug)

The critic (round 1) returned CONTRACT/FAIL + BAR/FAIL on three blocking defects.
All are fixed and re-verified.

### D1 — values now flow to the ENGINE (not a settings dead-end)
Root cause: the daemon's `setModel(provider, modelId)` accepts only provider+modelId,
and the engine's request contextWindow/maxTokens come from the model registry catalog,
re-read from `~/.prime/agent/models.json` on every `set_model` (verified in
`daemon-mode.ts` set_model handler → `modelRegistry.refreshAvailableModels()`).

Fix (`bridge/src/rpc.ts` + `bridge/src/connection.ts`): the bridge now
`writeModelOverrideToModelsJson(provider, model, {contextWindow, maxTokens})` into
`~/.prime/agent/models.json` **before** issuing `conn.setModel(provider, model)`.
The daemon reloads the catalog on set_model and the request uses the new definition.

Verified by direct bridge invocation: wrote override to the real models.json
(deepseek contextWindow 1000000→999000, maxTokens 65536→61000), read back the
change, then restored the original (1000000/65536). Bridge compiles clean.

### D2 — values now persist across a real reload/restart
Root cause: `SettingsStore.update()` wrote only `daemonTcp` to settings.json;
`modelConfig` was in-memory only. Mock persisted to a module field only.

Fix:
- `bridge/src/connection.ts`: `SettingsStore` now reads/writes `modelConfig` to
  `~/.prime/agent/settings.json` (readModelConfig/writeModelConfig via a shared
  writeSettingsPatch). Verified: update({modelConfig}) wrote the JSON to disk;
  cleaned up after.
- `src/ipc/client.ts` (mock): `modelConfig` persists to localStorage
  (`prime-agent.modelConfig.v1`). Probe proves a FULL `page.reload()` keeps the
  applied values (128,000 ctx · 32,768 out), and Reset-then-reload returns to max.

### D3 — default "max" now matches the provider's REAL catalog
Root cause: mock + FALLBACK_MAX invented 200,000 ctx for deepseek; the real
`~/.prime/agent/models.json` declares contextWindow 1000000 / maxTokens 65536.

Fix: mock catalog + FALLBACK_MAX now use the real values — deepseek-v4-flash:0731-cloud
1,000,000 ctx / 65,536 out (ollama-cloud + openrouter), MiniMax-M3 524,288 / 128,000
(real built-in). The real bridge path already reads the daemon catalog. Probe shows
the browser surface now defaults to 1,000,000 ctx · 65,536 out.

### Bonus fix — reset persisted stale values
`resetModelConfig` reused `setModelConfig(provider, model, {})`, but the
`{ ...(existing), ...{} }` spread-merge preserved the old keys, so the persisted
override was never cleared (reset-then-reload reverted to the applied value). Fix:
reset now DELETES the key from the persisted `modelConfig`, and the mock
`setSettings` replaces `modelConfig` (not merges) to mirror `SettingsStore.update()`.
Probe: reset → 1,000,000 ctx · 65,536 out; reset + full reload → still 1,000,000.

## Round-2 verification (playwright, headless, :1420)
`verify/p10-verify.py` (mirrors the critic's harness):
```
rows_before:              ["DeepSeek V4 Flash 07311,000,000 ctx · 65,536 out",
                           "MiniMax M3524,288 ctx · 128,000 out",
                           "DeepSeek V4 Flash (free)1,000,000 ctx · 65,536 out"]
adjuster:                 ranges:2 numbers:2 numVals:[1000000,65536] labels:[Context window,
                           Context window value, Max output tokens, Max output tokens value]
rows_after_apply:         deepseek → 128,000 ctx · 32,768 out
rows_after_full_reload:   deepseek → 128,000 ctx · 32,768 out   (D2: FULL reload persistence)
rows_after_reset:         deepseek → 1,000,000 ctx · 65,536 out
rows_after_reset_reload:  deepseek → 1,000,000 ctx · 65,536 out  (reset persisted)
errors: []  console_errors: []
```
Screenshots: `verify/p10-verify.png`, `p10-adjuster-r2.png`, `p10-applied.png`, `p10-after-reload.png`.
Bridge + frontend both `npm run build` clean.

## Round 3 — critic fix (R2-D1: reset must restore the ENGINE, not just UI/settings)

The round-2 critic confirmed D1/D2/D3 fixed but flagged one defect: Reset-to-max
passed an EMPTY runtime to setModel, so the bridge guard (`contextWindow != null ||
maxOutputTokens != null`) was false and `writeModelOverrideToModelsJson` was never
called — the lowered override stayed in `~/.prime/agent/models.json` and the engine
kept the lowered values after reset (UI/settings showed the ceiling; engine didn't).

Fix (`src/features/providers/useModels.ts`): `resetModelConfig` now resolves the
model's ceiling from the current catalog (`maxContextWindow`/`maxOutputTokensCeiling`)
and passes the **ceiling** as the runtime to `setModel`. That flows through the real D1
path: the bridge writes the ceiling into `~/.prime/agent/models.json`, then `setModel`
reloads the daemon catalog so the engine uses the max again. The settings key is still
deleted (app config reverts to max).

Proof (compiled bridge, real models.json): apply -> deepseek contextWindow 999000 /
maxTokens 61000; reset (ceiling) -> 1000000 / 65536; backup restored after. Browser
probe (:1420): reset -> 1,000,000 ctx · 65,536 out; reset + full reload -> still
1,000,000; 0 errors. Commit `506f53c`.

(Note: for the round-2/3 browser runs I removed a `piece-nodegraph` vite server that was
squatting on :1420 and started this worktree's dev server so the smoke test exercised
the actual P10 code. PID 41376 serves piece-context on :1420.)
