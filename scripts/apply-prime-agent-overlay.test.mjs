import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PRIME_AGENT_PIN } from "./runtime-pins.mjs";
import { PRIME_AGENT_SESSION_LEASE_OVERLAY, preparePrimeAgentBuildTree } from "./apply-prime-agent-overlay.mjs";

const SESSION_LEASE_PATH = "packages/coding-agent/src/core/session-lease.ts";
const BASE_SOURCE = 'export const leaseOwner = "pinned-base";\n';
const PATCHED_SOURCE = 'export const leaseOwner = "audited-overlay";\n';
const FIXTURE_PATCH = [
  `diff --git a/${SESSION_LEASE_PATH} b/${SESSION_LEASE_PATH}`,
  `--- a/${SESSION_LEASE_PATH}`,
  `+++ b/${SESSION_LEASE_PATH}`,
  "@@ -1 +1 @@",
  '-export const leaseOwner = "pinned-base";',
  '+export const leaseOwner = "audited-overlay";',
  "",
].join("\n");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function runGit(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function createFixture(t) {
  const projectRoot = mkdtempSync(join(tmpdir(), "prime-agent-overlay-test-"));
  t.after(() => rmSync(projectRoot, { recursive: true, force: true }));
  const sourceRoot = join(projectRoot, "source");
  mkdirSync(join(sourceRoot, "packages", "coding-agent", "src", "core"), { recursive: true });
  mkdirSync(join(projectRoot, "patches"), { recursive: true });
  writeFileSync(join(sourceRoot, "LICENSE"), "MIT License\nfixture license\n");
  writeFileSync(join(sourceRoot, "packages", "coding-agent", "package.json"), JSON.stringify({ version: "0.7.0", license: "MIT" }));
  writeFileSync(join(sourceRoot, SESSION_LEASE_PATH), BASE_SOURCE);
  writeFileSync(join(projectRoot, "patches", "fixture.patch"), FIXTURE_PATCH);
  runGit(["init", "--quiet"], sourceRoot);
  runGit(["config", "user.name", "Session Lease Test"], sourceRoot);
  runGit(["config", "user.email", "session-lease-test@example.invalid"], sourceRoot);
  runGit(["add", "--all"], sourceRoot);
  runGit(["commit", "--quiet", "-m", "fixture source"], sourceRoot);
  const commit = runGit(["rev-parse", "HEAD"], sourceRoot);
  const repository = "https://prime-agent-fixture.invalid/prime-agent.git";
  runGit(["remote", "add", "origin", repository], sourceRoot);
  const pin = { repository, ref: "fixture-v0.7.0", commit, version: "0.7.0", license: "MIT" };
  const overlay = {
    id: "fixture-session-lease-overlay",
    upstreamCommit: commit,
    upstreamRepository: repository,
    sourcePath: SESSION_LEASE_PATH,
    sourceSha256: sha256(BASE_SOURCE),
    patchPath: "patches/fixture.patch",
    patchSha256: sha256(FIXTURE_PATCH),
    patchedSourceSha256: sha256(PATCHED_SOURCE),
  };
  return { projectRoot, sourceRoot, pin, overlay };
}

test("the production overlay is bound to the public source and exact patch hashes", () => {
  const patchPath = join(process.cwd(), PRIME_AGENT_SESSION_LEASE_OVERLAY.patchPath);
  const textAttribute = execFileSync("git", ["check-attr", "text", "--", PRIME_AGENT_SESSION_LEASE_OVERLAY.patchPath], {
    cwd: process.cwd(),
    encoding: "utf8",
  }).trim();
  assert.match(textAttribute, /: text: unset$/);
  assert.equal(PRIME_AGENT_SESSION_LEASE_OVERLAY.upstreamCommit, PRIME_AGENT_PIN.commit);
  assert.equal(PRIME_AGENT_SESSION_LEASE_OVERLAY.upstreamRepository, PRIME_AGENT_PIN.repository);
  assert.equal(PRIME_AGENT_SESSION_LEASE_OVERLAY.sourceSha256, "78ae066a92f101771875a9d566549761ab459aaa4c7f6ce1de087cc00a6e462a");
  assert.equal(sha256(readFileSync(patchPath)), PRIME_AGENT_SESSION_LEASE_OVERLAY.patchSha256);
  assert.equal(PRIME_AGENT_SESSION_LEASE_OVERLAY.patchSha256, "ad532cd1e52dd1e6e05bb3e8fd788cf73aee6ecb6be955c38dc43c042f3d8a27");
  assert.equal(PRIME_AGENT_SESSION_LEASE_OVERLAY.patchedSourceSha256, "006802f39f6de128e6b7f418e9fb3b2793ef73410d1247db562ce5dcbe7a0349");
});

test("applies only to a separate build tree and leaves the pinned source clean", (t) => {
  const fixture = createFixture(t);
  const first = preparePrimeAgentBuildTree(fixture.projectRoot, fixture.sourceRoot, fixture);
  assert.notEqual(first.path, fixture.sourceRoot);
  assert.equal(readFileSync(join(fixture.sourceRoot, SESSION_LEASE_PATH), "utf8"), BASE_SOURCE);
  assert.equal(runGit(["status", "--porcelain", "--untracked-files=all"], fixture.sourceRoot), "");
  assert.equal(readFileSync(join(first.path, SESSION_LEASE_PATH), "utf8"), PATCHED_SOURCE);
  assert.equal(runGit(["remote", "get-url", "origin"], first.path), fixture.pin.repository);
  assert.deepEqual(first.provenance, {
    id: fixture.overlay.id,
    upstreamRepository: fixture.pin.repository,
    upstreamCommit: fixture.pin.commit,
    sourcePath: SESSION_LEASE_PATH,
    sourceSha256: fixture.overlay.sourceSha256,
    patchPath: fixture.overlay.patchPath,
    patchSha256: fixture.overlay.patchSha256,
    patchedSourceSha256: fixture.overlay.patchedSourceSha256,
    sourceDirectory: fixture.sourceRoot,
    buildDirectory: first.path,
  });

  const second = preparePrimeAgentBuildTree(fixture.projectRoot, fixture.sourceRoot, fixture);
  assert.equal(second.path, first.path);
  assert.equal(readFileSync(join(second.path, SESSION_LEASE_PATH), "utf8"), PATCHED_SOURCE);
  assert.equal(runGit(["status", "--porcelain", "--untracked-files=all"], fixture.sourceRoot), "");
});

test("checks out exact pinned source bytes when Git autocrlf is enabled", (t) => {
  const fixture = createFixture(t);
  const globalConfig = join(fixture.projectRoot, "global.gitconfig");
  writeFileSync(globalConfig, "[core]\nautocrlf = true\n");
  const previousGlobalConfig = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = globalConfig;
  try {
    assert.equal(runGit(["config", "--global", "core.autocrlf"], fixture.sourceRoot), "true");
    const build = preparePrimeAgentBuildTree(fixture.projectRoot, fixture.sourceRoot, fixture);
    assert.equal(readFileSync(join(build.path, SESSION_LEASE_PATH), "utf8"), PATCHED_SOURCE);
    assert.equal(runGit(["status", "--porcelain", "--untracked-files=all"], fixture.sourceRoot), "");
  } finally {
    if (previousGlobalConfig === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = previousGlobalConfig;
  }
});

test("refuses a dirty pinned source tree before creating an overlay", (t) => {
  const fixture = createFixture(t);
  writeFileSync(join(fixture.sourceRoot, SESSION_LEASE_PATH), `${BASE_SOURCE}// unexpected change\n`);
  assert.throws(
    () => preparePrimeAgentBuildTree(fixture.projectRoot, fixture.sourceRoot, fixture),
    /dirty source tree/,
  );
  assert.equal(runGit(["status", "--porcelain", "--untracked-files=all"], fixture.sourceRoot).startsWith("M "), true);
});

test("rejects a mismatched upstream source hash without applying the patch", (t) => {
  const fixture = createFixture(t);
  const wrongOverlay = { ...fixture.overlay, sourceSha256: "0".repeat(64) };
  assert.throws(
    () => preparePrimeAgentBuildTree(fixture.projectRoot, fixture.sourceRoot, { ...fixture, overlay: wrongOverlay }),
    /source hash does not match/,
  );
  assert.equal(readFileSync(join(fixture.sourceRoot, SESSION_LEASE_PATH), "utf8"), BASE_SOURCE);
});

test("rejects a patch whose bytes do not match the pinned digest", (t) => {
  const fixture = createFixture(t);
  const wrongOverlay = { ...fixture.overlay, patchSha256: "0".repeat(64) };
  assert.throws(
    () => preparePrimeAgentBuildTree(fixture.projectRoot, fixture.sourceRoot, { ...fixture, overlay: wrongOverlay }),
    /patch SHA-256 does not match/,
  );
  assert.equal(readFileSync(join(fixture.sourceRoot, SESSION_LEASE_PATH), "utf8"), BASE_SOURCE);
});
