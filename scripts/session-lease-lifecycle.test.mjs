import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultLeaseModulePath = join(REPO, "resources", "daemon", "dist", "core", "session-lease.js");
const leaseModuleOverride = process.env.SOPHOS_SESSION_LEASE_TEST_MODULE;
const LEASE_MODULE = leaseModuleOverride
  ? (leaseModuleOverride.startsWith("file:") ? leaseModuleOverride : pathToFileURL(resolve(leaseModuleOverride)).href)
  : pathToFileURL(defaultLeaseModulePath).href;
const { acquireSessionLease, canonicalSessionPath, SESSION_LEASE_OWNER_ID_ENV, SESSION_LEASES_ENABLED_ENV, SessionAlreadyActiveError } = await import(LEASE_MODULE);
const tempRoots = new Set();

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "sophos-session-lease-runtime-"));
  tempRoots.add(root);
  const home = join(root, "home");
  const agentDir = join(home, ".prime", "agent");
  const projectDir = join(root, "project");
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(projectDir, { recursive: true });
  const sessionPath = join(projectDir, "session.jsonl");
  writeFileSync(sessionPath, "");
  const canonical = canonicalSessionPath(sessionPath);
  const key = createHash("sha256").update(canonical).digest("hex");
  return { root, home, agentDir, sessionPath, lockDir: join(agentDir, "session-leases", `${key}.lock`) };
}

function safeEnvironment(fixture, ownerId) {
  const environment = Object.fromEntries(
    ["PATH", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "SystemDrive", "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL", "TZ"]
      .filter((name) => process.env[name] !== undefined)
      .map((name) => [name, process.env[name]]),
  );
  return {
    ...environment,
    HOME: fixture.home,
    USERPROFILE: fixture.home,
    APPDATA: join(fixture.home, "AppData", "Roaming"),
    LOCALAPPDATA: join(fixture.home, "AppData", "Local"),
    PI_OFFLINE: "1",
    [SESSION_LEASES_ENABLED_ENV]: "1",
    [SESSION_LEASE_OWNER_ID_ENV]: ownerId,
    SESSION_PATH: fixture.sessionPath,
    AGENT_DIR: fixture.agentDir,
  };
}

function startLeaseHolder(fixture, ownerId) {
  const childSource = `
    import { acquireSessionLease, SESSION_LEASE_OWNER_ID_ENV, SESSION_LEASES_ENABLED_ENV } from ${JSON.stringify(LEASE_MODULE)};
    const lease = acquireSessionLease(process.env.SESSION_PATH, process.env.AGENT_DIR, {
      [SESSION_LEASES_ENABLED_ENV]: "1",
      [SESSION_LEASE_OWNER_ID_ENV]: process.env[SESSION_LEASE_OWNER_ID_ENV],
    });
    if (!lease) throw new Error("session lease was not acquired");
    process.stdout.write("LEASE_HELD\\n");
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      if (chunk.includes("release")) {
        lease.release();
        process.stdout.write("LEASE_RELEASED\\n");
        process.exit(0);
      }
    });
    setInterval(() => {}, 1000);
  `;
  return spawn(process.execPath, ["--input-type=module", "--eval", childSource], {
    cwd: fixture.root,
    env: safeEnvironment(fixture, ownerId),
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
}

async function waitForLine(child, wanted, timeoutMs = 30_000) {
  let stdout = "";
  let stderr = "";
  return new Promise((resolvePromise, rejectPromise) => {
    const timeout = setTimeout(() => finish(new Error(`timed out waiting for ${wanted}; stdout=${stdout}; stderr=${stderr}`)), timeoutMs);
    const finish = (error) => {
      clearTimeout(timeout);
      child.stdout.off("data", onStdout);
      child.stderr.off("data", onStderr);
      child.off("error", onError);
      child.off("close", onClose);
      if (error) rejectPromise(error);
      else resolvePromise({ stdout, stderr });
    };
    const onStdout = (chunk) => {
      stdout += chunk;
      if (stdout.includes(`${wanted}\n`)) finish();
    };
    const onStderr = (chunk) => { stderr += chunk; };
    const onError = (error) => finish(error);
    const onClose = (code, signal) => finish(new Error(`holder exited before ${wanted}: code=${code} signal=${signal}; stderr=${stderr}`));
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", onStdout);
    child.stderr.on("data", onStderr);
    child.once("error", onError);
    child.once("close", onClose);
  });
}

async function stopChild(child, graceful) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise((resolvePromise) => child.once("close", resolvePromise));
  if (graceful) child.stdin.end("release\n");
  else child.kill();
  let timeout;
  await Promise.race([closed, new Promise((resolvePromise) => { timeout = setTimeout(resolvePromise, 10_000); })]);
  if (timeout) clearTimeout(timeout);
  if (child.exitCode === null && child.signalCode === null) child.kill();
}

test.after(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
  tempRoots.clear();
});

test("a live lease holder keeps ownership while replacement is attempted with an open owner-file handle", async (t) => {
  const fixture = createFixture();
  const holder = startLeaseHolder(fixture, "live-holder");
  t.after(() => stopChild(holder, true));
  await waitForLine(holder, "LEASE_HELD");

  const ownerPath = join(fixture.lockDir, "owner.json");
  assert.equal(existsSync(ownerPath), true, "holder must publish owner provenance before acquisition completes");
  const ownerHandle = openSync(ownerPath, "r");
  try {
    const before = JSON.parse(readFileSync(ownerPath, "utf8"));
    assert.equal(before.activeSessionId, "live-holder");
    assert.throws(
      () => acquireSessionLease(fixture.sessionPath, fixture.agentDir, {
        [SESSION_LEASES_ENABLED_ENV]: "1",
        [SESSION_LEASE_OWNER_ID_ENV]: "replacement-worker",
      }),
      (error) => error instanceof SessionAlreadyActiveError
        && error.activeSessionId === "live-holder"
        && error.sessionPath === canonicalSessionPath(fixture.sessionPath),
      "replacement must report an active owner instead of exposing a raw Windows rename error",
    );
    const after = JSON.parse(readFileSync(ownerPath, "utf8"));
    assert.deepEqual(after, before, "a failed replacement must preserve the live owner's exact record");
    assert.deepEqual(readdirSync(join(fixture.agentDir, "session-leases")).filter((name) => name.includes(".candidate-")), []);
  } finally {
    closeSync(ownerHandle);
  }

  await stopChild(holder, true);
  assert.equal(existsSync(fixture.lockDir), false, "the original holder must release its own lease cleanly");
});

test("a replacement worker reclaims only after its prior holder has exited", async (t) => {
  const fixture = createFixture();
  const holder = startLeaseHolder(fixture, "worker-before-restart");
  t.after(() => stopChild(holder, false));
  await waitForLine(holder, "LEASE_HELD");
  const previousOwner = JSON.parse(readFileSync(join(fixture.lockDir, "owner.json"), "utf8"));

  await stopChild(holder, false);
  assert.equal(existsSync(fixture.lockDir), true, "a crashed worker leaves a stale owner record for safe reclamation");
  const replacement = acquireSessionLease(fixture.sessionPath, fixture.agentDir, {
    [SESSION_LEASES_ENABLED_ENV]: "1",
    [SESSION_LEASE_OWNER_ID_ENV]: "worker-after-restart",
  });
  assert.ok(replacement, "replacement must adopt a stale lease after proving the former process is gone");
  const newOwner = JSON.parse(readFileSync(join(fixture.lockDir, "owner.json"), "utf8"));
  assert.equal(newOwner.activeSessionId, "worker-after-restart");
  assert.notEqual(newOwner.token, previousOwner.token, "replacement must write new owner provenance");
  assert.equal(newOwner.sessionPath, canonicalSessionPath(fixture.sessionPath));
  replacement.release();
  assert.equal(existsSync(fixture.lockDir), false, "replacement release removes only its own lease");
});

test("release preserves a replacement owner's record when the token no longer matches", (t) => {
  const fixture = createFixture();
  const lease = acquireSessionLease(fixture.sessionPath, fixture.agentDir, {
    [SESSION_LEASES_ENABLED_ENV]: "1",
    [SESSION_LEASE_OWNER_ID_ENV]: "original-owner",
  });
  assert.ok(lease);
  const ownerPath = join(fixture.lockDir, "owner.json");
  const originalOwner = JSON.parse(readFileSync(ownerPath, "utf8"));
  const replacementOwner = { ...originalOwner, token: "replacement-token", activeSessionId: "replacement-owner" };
  writeFileSync(ownerPath, `${JSON.stringify(replacementOwner, null, 2)}\n`);
  const ownerHandle = openSync(ownerPath, "r");
  try {
    lease.release();
    assert.equal(existsSync(fixture.lockDir), true, "release must not remove a lease owned by a different token");
    assert.deepEqual(JSON.parse(readFileSync(ownerHandle, "utf8")), replacementOwner);
  } finally {
    closeSync(ownerHandle);
    rmSync(fixture.root, { recursive: true, force: true });
    tempRoots.delete(fixture.root);
  }
});
