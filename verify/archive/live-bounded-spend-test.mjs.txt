// verify/live-bounded-spend-test.mjs
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { readFileSync, writeFileSync } from 'node:fs';

const REF = 'C:/Users/Cayleb/Desktop/workspace/prime-agent-ref/packages/coding-agent';
const INST = 'C:/Users/Cayleb/AppData/Local/Sophos';
const NODE = INST + '/node/node.exe';
const DAEMON_SRC = join(REF, 'dist', 'bundle', 'cli.js');
const BRIDGE = INST + '/bridge/dist/bridge/src/index.js';
const PORT = 48650 + Math.floor(Math.random() * 200);
const SPEC = 'tcp://127.0.0.1:' + PORT;

// NOTE: maxCost is a client-side constant ($50) in useRunGuard, NOT a daemon
// setting. The daemon enforces maxTurns + maxTokens. We use tight bounds so
// the breaker trips on iteration count while real cost accumulates and is
// reported. To watch a *pure* cost trip, lower DEFAULT_MAX_COST in
// useRunGuard.ts. Cap: 2 iterations, 1000 tokens — cost will be < $0.01.
const MAX_COST = 1.0;
const MAX_TURNS = 2;
const MAX_TOKENS = 1000;
const POLL_MS = 4000;

// Module-level backup of the global settings file so we can restore it after the test.
let _originalSettingsBackup = null;
const _settingsPath = join(process.env.USERPROFILE || '', '.prime', 'agent', 'settings.json');
const _restoreSettings = () => {
  if (_originalSettingsBackup) { try { writeFileSync(_settingsPath, _originalSettingsBackup); } catch {} }
};
const _writeBoundedConfig = () => {
  try { _originalSettingsBackup = readFileSync(_settingsPath, 'utf8'); } catch { _originalSettingsBackup = null; }
  try {
    const parsed = _originalSettingsBackup ? JSON.parse(_originalSettingsBackup) : {};
    parsed.autonomousConfig = { active: false, maxTurns: MAX_TURNS, maxTokens: MAX_TOKENS };
    writeFileSync(_settingsPath, JSON.stringify(parsed, null, 2));
    return true;
  } catch (e) { warn('could not pre-write settings', e.message); return false;


const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const note = (name, ok, detail) => { results.push({ name, ok: !!ok, detail: detail || '' }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? ' \u2014 ' + detail : '')); };
const info = (name, detail) => { results.push({ name, ok: null, detail: detail || '' }); console.log('INFO  ' + name + (detail ? ' \u2014 ' + detail : '')); };
const warn = (name, detail) => console.log('WARN  ' + name + (detail ? ' \u2014 ' + detail : ''));

async function main() {
  console.log('=================================================');
  console.log(' BOUNDED LIVE-SPEND TEST \u2014 ollama-cloud / deepseek-v4-flash');
  console.log(' cap: $' + MAX_COST.toFixed(2) + ' | ' + MAX_TURNS + ' turns | ' + MAX_TOKENS + ' tokens');
  console.log('=================================================\n');

  const work = mkdtempSync(join(tmpdir(), 'sophos-spend-'));
  mkdirSync(join(work, 'proj'), { recursive: true });

  // The daemon reads autonomousConfig from the settings file at startup.
  // Pre-write our bounded budget there (backing up the original first).
  _writeBoundedConfig();



  const daemon = spawn(NODE, [DAEMON_SRC, '--mode', 'daemon', '--daemon-socket', SPEC], {
    cwd: join(work, 'proj'), stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PRIME_DAEMON_TCP: '1' },
  });
  // Wait for the proven handshake: daemon prints "listening on tcp://..." to stderr.
  let daemonUp = false;
  await new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('daemon did not start')), 30000);
    daemon.stderr.on('data', (d) => {
      const str = d.toString();
      const m = str.match(/listening on (tcp:\/\/\S+)/i);
      if (m) { daemonUp = true; clearTimeout(to); resolve(); }
    });
  });
  note('real daemon listening', daemonUp, SPEC);

  const bridge = spawn(process.execPath, [BRIDGE], {
    cwd: join(work, 'proj'), stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, PRIME_DAEMON_TCP: '1', PRIME_DAEMON_TCP_PORT: String(PORT) },
  });
  let id = 0; const pending = new Map(); let connected = false;
  createInterface({ input: bridge.stdout }).on('line', (line) => {
    let m; try { m = JSON.parse(line); } catch { return; }
    if (m.id !== undefined && pending.has(m.id)) { const { resolve: res } = pending.get(m.id); pending.delete(m.id); res(m); return; }
    if (m.type === 'connection_status' && m.status?.kind === 'connected') connected = true;
    if (m.type === 'snapshot' && m.state?.status?.kind === 'connected') connected = true;
  });
  const call = (method, params, timeout) => new Promise((res) => {
    const rid = ++id; pending.set(rid, { resolve: res });
    bridge.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: rid, method, params: params || {} }) + '\n');
    setTimeout(() => { if (pending.has(rid)) { pending.delete(rid); res({ error: { message: 'timeout' } }); } }, timeout || 60000);
  });
  for (let i = 0; i < 60 && !connected; i++) await sleep(500);
  note('bridge connected', connected);
  if (!connected) return finish(daemon, bridge, 'bridge never connected');

  await call('setSettings', { settings: { autonomousConfig: { active: false, maxTurns: MAX_TURNS, maxTokens: MAX_TOKENS } } });
  const cfg = (await call('getState')).result?.autonomousConfig || {};
  note('bounded config applied', cfg.maxTurns === MAX_TURNS && cfg.maxTokens === MAX_TOKENS, 'maxTurns=' + cfg.maxTurns + ' maxTokens=' + cfg.maxTokens);

  const goal = 'Read the file README.md in the current directory. Reply with one concrete improvement. Keep the reply under 100 words.';
  info('setting goal', goal.slice(0, 70));
  const goalRes = await call('prompt', { text: '/goal ' + goal }, 120000);
  note('goal accepted', !goalRes.error, (goalRes.error?.message || 'ok').slice(0, 120));

  // Enable autonomous via the slash command the frontend uses (the
  // autonomousConfig.active flag is informational, not the trigger).
  const autoRes = await call('prompt', { text: '/autonomous on' }, 120000);
  note('autonomous enabled via /autonomous on', !autoRes.error, (autoRes.error?.message || 'ok').slice(0, 120));

  let trip = null; let lastCost = -1;
  for (let i = 0; i < 60; i++) {
    await sleep(POLL_MS);
    const st = (await call('getState')).result || {};
    const cost = st.costStats?.totalCost ?? 0;
    const tokens = st.context?.tokens ?? 0;
    const autoActive = st.autonomousConfig?.active ?? false;
    const goalStatus = st.goals?.[0]?.status ?? 'none';
    const guard = st.runGuard ?? {};
    if (cost !== lastCost || i % 3 === 0) {
      console.log('  [poll ' + (i + 1) + '] cost=$' + cost.toFixed(4) + ' tokens=' + tokens + ' auto=' + autoActive + ' goal=' + goalStatus + ' tripped=' + (guard.budgetTripped ?? false));
      lastCost = cost;
    }
    if (guard.budgetTripped) { trip = { reason: 'budget', text: guard.reason, cost, tokens }; break; }
    if (cost >= MAX_COST) { trip = { reason: 'cap', cost, tokens }; break; }
    if (!autoActive) { trip = { reason: 'inactive', cost, tokens }; break; }
  }

  await call('prompt', { text: '/autonomous off' }, 30000).catch(() => {});
  const finalCost = (await call('getState')).result?.costStats?.totalCost ?? 0;

  console.log('\n================ RESULT ================');
  if (trip?.reason === 'budget') note('CIRCUIT-BREAKER TRIPPED ON REAL COST', true, trip.text || '$' + trip.cost.toFixed(4));
  else if (trip?.reason === 'cap') warn('cost reached the cap without the breaker flagging', '$' + finalCost.toFixed(4));
  else if (trip?.reason === 'inactive') info('run stopped itself (goal done or idle)', '$' + finalCost.toFixed(4));
  else warn('ended without a trip', '$' + finalCost.toFixed(4));

  console.log('\nTOTAL SPEND: $' + finalCost.toFixed(4) + '  (cap was $' + MAX_COST.toFixed(2) + ')');
  console.log('RESULT:', (finalCost > 0 && finalCost <= MAX_COST) ? 'PASS' : 'REVIEW');
  return finish(daemon, bridge, null, (finalCost > 0 && finalCost <= MAX_COST) ? 0 : 1);
}

function finish(daemon, bridge, errMsg, code) {
  code = code || 1;
  try { bridge?.kill('SIGKILL'); } catch {}
  try { daemon?.kill('SIGKILL'); } catch {}
  _restoreSettings();
  if (errMsg) console.error('ABORT:', errMsg);
  process.exit(code);
}

main().catch((e) => { console.error('test FATAL:', e); process.exit(2); });

