# Verification Evidence — P4 Settings Piece

## Build Output
```
> prime-agent-windows@0.1.0 build
> tsc && vite build

vite v6.4.3 building for production...
transforming...
✓ 78 modules transformed.
rendering chunks...
computing gzip size...
dist/                   index.html                  0.40 kB │ gzip:  0.27 kB
dist/                   assets/index-1S0j0mOO.css   19.34 kB │ gzip:  4.36 kB
dist/                   assets/core-BEOw45JP.js     0.20 kB │ gzip:  0.15 kB
dist/                   assets/event-Gip4rtXm.js    1.12 kB │ gzip:  0.60 kB
dist/                   assets/index-BW6Cp2u7.js    275.66 kB │ gzip: 78.26 kB
✓ built in 1.64s
```

## Dev Server Smoke Test
- Server starts on port 1420: ✓
- HTML served successfully: ✓
- No TypeScript errors: ✓
- Vite HMR client injected: ✓

## Files Modified/Created
- `src/features/providers/useModels.ts` — Added thinking level support (off/minimal/low/medium/high/xhigh/max)
- `src/features/providers/ModelSelector.tsx` — Added thinking-level dropdown for models supporting thinking
- `src/features/settings/ProvidersPanel.tsx` — Enhanced model cards with context window + thinking indicator
- `src/features/settings/AdvancedPanel.tsx` — Added daemon diagnostics, MCP servers, extensions panels
- `src/features/settings/SettingsView.tsx` — Added Skills tab
- `src/features/settings/SkillsPanel.tsx` — New: Skills management surface (built-in, global, project, package)
- `src/views/SettingsView.tsx` — Updated to use real SettingsFeature
- `src/features/commands/commands.tsx` — Added /compact, /retry, /skills, /skill:create commands
- `src/features/sessions/icons.tsx` — Added LinkIcon, ShieldIcon, BookIcon, XIcon

## IPC Contract Compliance
- `login(provider, apiKey)` — wired in ProvidersPanel LoginModal
- `logout(provider)` — wired in ProvidersPanel
- `getProviders` / `getModels` — wired in ProvidersPanel, ModelSelector
- `setModel(provider, model, thinking)` — wired in ModelSelector with thinking level
- `getSettings` / `setSettings` — wired in GeneralPanel, SkillsPanel, AdvancedPanel (MCP/extensions)
- `runCommand` — wired in CommandPalette for /refine, /compact, /retry, /goal, /autonomous, /heartbeat, /schedule, /skills, /skill:create
- `compact` — wired in AdvancedPanel Compact button
- `getContextStats` / `getRlmChildren` / `listAgents` — wired in AdvancedPanel

## Graceful Degradation
- MockIpcClient provides neutral data when daemon unreachable
- Settings panels show "managed by engine" state where daemon doesn't expose data
- No fake data — empty states with clear messages