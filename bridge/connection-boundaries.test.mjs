#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
  statSync,
} from "node:fs";
import { once } from "node:events";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileAuthStorageBackend } from "@earendil-works/pi-coding-agent";
import test from "node:test";

const isolatedHome = mkdtempSync(join(tmpdir(), "sophos-bridge-boundaries-"));
process.env.HOME = isolatedHome;
process.env.USERPROFILE = isolatedHome;
process.env.APPDATA = join(isolatedHome, "AppData", "Roaming");
process.env.LOCALAPPDATA = join(isolatedHome, "AppData", "Local");

const agentDir = join(isolatedHome, ".prime", "agent");
mkdirSync(agentDir, { recursive: true });
writeFileSync(
  join(agentDir, "settings.json"),
  JSON.stringify({ theme: "dark", auth: { anthropic: "legacy-secret" } }),
  "utf8",
);

const bridge = await import("./dist/bridge/src/connection.js");

test.after(() => rmSync(isolatedHome, { recursive: true, force: true }));

test("experimental live bridge operations fail explicitly instead of returning synthetic success", async () => {
  const connection = {};
  const unsupportedCalls = [
    ["restoreCheckpoint", () => bridge.restoreCheckpoint(connection, "ckpt-1")],
    ["getSquadTopology", () => bridge.getSquadTopology(connection)],
    ["evaluateSquadPiece", () => bridge.evaluateSquadPiece(connection, "child", "contract", "bar", [])],
    ["getMcpServers", () => bridge.getMcpServers(connection)],
    ["readMcpResource", () => bridge.readMcpResource(connection, "filesystem", "file:///tmp/file")],
    ["getMcpPrompt", () => bridge.getMcpPrompt(connection, "filesystem", "review")],
    ["getSecurityAuditLog", () => bridge.getSecurityAuditLog(connection)],
    ["getSecurityPolicy", () => bridge.getSecurityPolicy(connection)],
    ["setSecurityPolicy", () => bridge.setSecurityPolicy(connection, "strict-sandbox")],
    ["analyzeBlastRadius", () => bridge.analyzeBlastRadius(connection, "unknown-command")],
    ["getSquadWorkflow", () => bridge.getSquadWorkflow(connection)],
    ["runSquadWorkflow", () => bridge.runSquadWorkflow(connection, "sequential", "goal", "bar")],
    ["pauseSquadWorkflow", () => bridge.pauseSquadWorkflow(connection, "wf-1")],
    ["listDesktopWindows", () => bridge.listDesktopWindows(connection)],
    ["inspectDesktopWindow", () => bridge.inspectDesktopWindow(connection, "window")],
    ["dispatchDesktopAction", () => bridge.dispatchDesktopAction(connection, "window", { kind: "click" })],
    ["captureDesktopScreenshot", () => bridge.captureDesktopScreenshot(connection, "window")],
    ["listDistilledSkills", () => bridge.listDistilledSkills(connection)],
    ["distillSkillFromTrajectory", () => bridge.distillSkillFromTrajectory(connection, "session")],
    ["promoteSkill", () => bridge.promoteSkill(connection, "skill")],
    ["deleteDistilledSkill", () => bridge.deleteDistilledSkill(connection, "skill")],
    ["getThoughtTree", () => bridge.getThoughtTree(connection)],
    ["runSpeculativeBranch", () => bridge.runSpeculativeBranch(connection, "root", "hypothesis")],
    ["pruneThoughtBranch", () => bridge.pruneThoughtBranch(connection, "node")],
    ["promoteThoughtBranch", () => bridge.promoteThoughtBranch(connection, "node")],
    ["listWorkspaceTwins", () => bridge.listWorkspaceTwins(connection)],
    ["createWorkspaceTwin", () => bridge.createWorkspaceTwin(connection, "twin")],
    ["executeInTwin", () => bridge.executeInTwin(connection, "twin", "test")],
    ["diffWorkspaceTwin", () => bridge.diffWorkspaceTwin(connection, "twin")],
    ["mergeWorkspaceTwin", () => bridge.mergeWorkspaceTwin(connection, "twin")],
    ["rollbackWorkspaceTwin", () => bridge.rollbackWorkspaceTwin(connection, "twin")],
  ];

  for (const [name, operation] of unsupportedCalls) {
    await assert.rejects(operation, new RegExp(`${name}.*unsupported|unsupported.*${name}`, "i"), name);
  }
});

test("checkpoint markers stay explicitly unverified and restore is unsupported", async () => {
  const checkpoint = await bridge.createCheckpoint(
    {
      getState: async () => ({
        activeSessionId: "session-real",
        sessionId: "session-real",
        cwd: "C:/repo",
        messageCount: 17,
      }),
    },
    "review point",
  );

  assert.equal(checkpoint.sessionId, "session-real");
  assert.equal(checkpoint.turnIndex, 17);
  assert.equal(checkpoint.verifiedStatus, "UNVERIFIED");
  assert.equal(checkpoint.stateSnapshot?.appliedEditsCount, undefined);
  await assert.rejects(bridge.restoreCheckpoint({}, checkpoint.id), /unsupported/i);

  writeFileSync(
    join(isolatedHome, ".prime", "agent", "checkpoints", "checkpoints.json"),
    JSON.stringify([{ ...checkpoint, id: "legacy-green", verifiedStatus: "GREEN" }]),
    "utf8",
  );
  const [legacy] = await bridge.listCheckpoints({ getState: async () => ({}) });
  assert.equal(legacy.verifiedStatus, "UNVERIFIED");
});

test("compaction delegates to the daemon and reports unknown post-compaction counts as null", async () => {
  let compactCalls = 0;
  const connection = {
    getState: async () => ({
      contextUsage:
        compactCalls === 0
          ? { tokens: 1234, contextWindow: 8192, percent: 15.06 }
          : { tokens: null, contextWindow: 8192, percent: null },
    }),
    compact: async () => {
      compactCalls += 1;
      return { summary: "summary", firstKeptEntryId: "entry-1", tokensBefore: 1234 };
    },
  };

  const result = await bridge.compactContext(connection, "semantic-summarize");
  assert.equal(compactCalls, 1);
  assert.deepEqual(result, { beforeTokens: 1234, afterTokens: null, savedTokens: null });
});

test("compaction does not report negative token savings when context grows", async () => {
  let stateReads = 0;
  const result = await bridge.compactContext(
    {
      getState: async () => ({
        contextUsage: {
          tokens: stateReads++ === 0 ? 100 : 140,
          contextWindow: 8192,
          percent: null,
        },
      }),
      compact: async () => ({ summary: "summary", firstKeptEntryId: "entry-1", tokensBefore: 100 }),
    },
    "semantic-summarize",
  );
  assert.deepEqual(result, { beforeTokens: 100, afterTokens: 140, savedTokens: null });
});

test("unsupported compaction strategies do not trigger daemon compaction", async () => {
  let compactCalls = 0;
  const connection = {
    compact: async () => {
      compactCalls += 1;
    },
  };
  await assert.rejects(bridge.compactContext(connection, "prune-oldest"), /unsupported/i);
  await assert.rejects(bridge.compactContext(connection, "evict-tools"), /unsupported/i);
  assert.equal(compactCalls, 0);
});

test("token budget uses daemon context usage and fails when the count is unavailable", async () => {
  const budget = await bridge.getTokenBudget({
    getState: async () => ({ contextUsage: { tokens: 120, contextWindow: 2000, percent: 6 } }),
  });
  assert.deepEqual(budget, { totalTokens: 120, contextLimit: 2000, usagePercent: 6 });
  await assert.rejects(
    bridge.getTokenBudget({
      getState: async () => ({ contextUsage: { tokens: null, contextWindow: 2000, percent: null } }),
    }),
    /unavailable/i,
  );
  await assert.rejects(bridge.getTokenBudget({ getState: async () => ({}) }), /unavailable/i);
});

test("legacy API keys migrate to a private auth file and never appear in settings reads or writes", () => {
  const store = new bridge.SettingsStore();
  const settingsPath = join(agentDir, "settings.json");
  const authPath = join(agentDir, "auth.json");
  const settingsText = readFileSync(settingsPath, "utf8");
  const auth = JSON.parse(readFileSync(authPath, "utf8"));

  assert.equal(store.get().auth, undefined);
  assert.equal(settingsText.includes("legacy-secret"), false);
  assert.deepEqual(auth.anthropic, { type: "api_key", key: "legacy-secret" });
  if (process.platform !== "win32") assert.equal(statSync(authPath).mode & 0o777, 0o600);

  store.update({ auth: { openai: "new-secret" } });
  const afterSettings = readFileSync(settingsPath, "utf8");
  assert.equal(afterSettings.includes("new-secret"), false);
  assert.equal(store.get().auth, undefined);

  bridge.writeAuthKey("openai", "new-secret");
  assert.equal(JSON.parse(readFileSync(authPath, "utf8")).openai.key, "new-secret");
  assert.throws(() => bridge.writeAuthKey("openai", "  \t "), /non-empty string/i);
  assert.equal(JSON.parse(readFileSync(authPath, "utf8")).openai.key, "new-secret");
  if (process.platform !== "win32") {
    assert.equal(statSync(authPath).mode & 0o777, 0o600);
    chmodSync(authPath, 0o644);
    bridge.writeAuthKey("openai", "new-secret");
    assert.equal(statSync(authPath).mode & 0o777, 0o600);
  }
  bridge.writeAuthKey("openai");
  const afterLogout = JSON.parse(readFileSync(authPath, "utf8"));
  assert.equal(afterLogout.openai, undefined);
  assert.equal(afterLogout.anthropic.key, "legacy-secret");
});

test("settings persistence failure leaves the prior in-memory state intact", () => {
  const store = new bridge.SettingsStore();
  const settingsPath = join(agentDir, "settings.json");
  const originalSettings = readFileSync(settingsPath, "utf8");
  const previous = store.get();

  unlinkSync(settingsPath);
  mkdirSync(settingsPath);
  try {
    assert.throws(() => store.update({ defaultModel: "unsaved-model" }));
    assert.deepEqual(store.get(), previous);
  } finally {
    rmSync(settingsPath, { recursive: true, force: true });
    writeFileSync(settingsPath, originalSettings, "utf8");
  }
});

test("bridge auth updates share the daemon lock and preserve concurrent credential refreshes", async () => {
  const authPath = join(agentDir, "auth.json");
  const backend = new FileAuthStorageBackend(authPath);
  let signalLockAcquired;
  const lockAcquired = new Promise((resolve) => {
    signalLockAcquired = resolve;
  });
  const daemonRefresh = backend.withLockAsync(async (current) => {
    const currentAuth = JSON.parse(current ?? "{}");
    signalLockAcquired();
    await new Promise((resolve) => setTimeout(resolve, 100));
    currentAuth.anthropic = {
      type: "oauth",
      access: "refreshed-access-token",
      refresh: "refresh-token",
      expires: 1234567890,
    };
    return { result: undefined, next: JSON.stringify(currentAuth, null, 2) };
  });
  await lockAcquired;

  const connectionModuleUrl = new URL("./dist/bridge/src/connection.js", import.meta.url).href;
  const childSource = `import { writeAuthKey } from ${JSON.stringify(connectionModuleUrl)}; writeAuthKey("openai", "fixture-key");`;
  const writer = spawn(process.execPath, ["--input-type=module", "-e", childSource], {
    env: process.env,
    stdio: ["ignore", "ignore", "pipe"],
  });
  let childStderr = "";
  writer.stderr.on("data", (chunk) => {
    childStderr += chunk.toString();
  });
  const [exitCode] = await once(writer, "exit");
  await daemonRefresh;

  assert.equal(exitCode, 0, `concurrent bridge writer failed: ${childStderr.slice(0, 240)}`);
  const savedAuth = JSON.parse(readFileSync(authPath, "utf8"));
  assert.deepEqual(savedAuth.anthropic, {
    type: "oauth",
    access: "refreshed-access-token",
    refresh: "refresh-token",
    expires: 1234567890,
  });
  assert.deepEqual(savedAuth.openai, { type: "api_key", key: "fixture-key" });
});
