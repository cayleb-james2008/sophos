import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  applyReviewedSourcePatches,
  matchesPrimeAgentSecurityBuildProvenance,
  PRIME_AGENT_SECURITY_BUILD_PROVENANCE_EXPECTED,
  resolvePrimeAgentSecurityWorkPaths,
  samePath,
} from "./prepare-prime-agent-security-build.mjs";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function runGit(args, cwd, options = {}) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" },
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr ?? ""}`);
  return (result.stdout ?? "").trim();
}

async function makeFixture() {
  const root = await mkdtemp(join(tmpdir(), "sophos-security-patch-sequence-"));
  const source = join(root, "packages/coding-agent/src/core/session-lease.ts");
  await mkdir(join(root, "packages/coding-agent/src/core"), { recursive: true });
  await writeFile(source, 'export const state = "base";\n');
  runGit(["init", "--quiet", "--initial-branch=main"], root);
  runGit(["config", "core.autocrlf", "false"], root);
  runGit(["config", "user.name", "Sophos test"], root);
  runGit(["config", "user.email", "sophos-test@example.invalid"], root);
  runGit(["add", "packages/coding-agent/src/core/session-lease.ts"], root);
  runGit(["commit", "--quiet", "-m", "fixture base"], root);
  return { root, source };
}

const leasePatch = Buffer.from(
  "diff --git a/packages/coding-agent/src/core/session-lease.ts b/packages/coding-agent/src/core/session-lease.ts\n"
  + "--- a/packages/coding-agent/src/core/session-lease.ts\n"
  + "+++ b/packages/coding-agent/src/core/session-lease.ts\n"
  + "@@ -1 +1,2 @@\n"
  + ' export const state = "base";\n'
  + "+export const lease = true;\n",
);
const zipGuardPatch = Buffer.from(
  "diff --git a/packages/coding-agent/src/core/session-lease.ts b/packages/coding-agent/src/core/session-lease.ts\n"
  + "--- a/packages/coding-agent/src/core/session-lease.ts\n"
  + "+++ b/packages/coding-agent/src/core/session-lease.ts\n"
  + "@@ -2,0 +3 @@\n"
  + "+export const archiveGuard = true;\n",
);
const linuxWorkerSocketPathPatch = Buffer.from(
  "diff --git a/packages/coding-agent/src/core/session-lease.ts b/packages/coding-agent/src/core/session-lease.ts\n"
  + "--- a/packages/coding-agent/src/core/session-lease.ts\n"
  + "+++ b/packages/coding-agent/src/core/session-lease.ts\n"
  + "@@ -3,0 +4 @@\n"
  + "+export const workerSocketPath = true;\n",
);
const workerShutdownFencePatch = Buffer.from(
  "diff --git a/packages/coding-agent/src/core/session-lease.ts b/packages/coding-agent/src/core/session-lease.ts\n"
  + "--- a/packages/coding-agent/src/core/session-lease.ts\n"
  + "+++ b/packages/coding-agent/src/core/session-lease.ts\n"
  + "@@ -3 +3,2 @@\n"
  + " export const archiveGuard = true;\n"
  + "+export const shutdownFence = true;\n",
);

const reviewedPatchSequence = [
  { name: "session-lease", bytes: leasePatch, sha256: sha256(leasePatch), unidiffZero: false },
  { name: "windows-zip-guard", bytes: zipGuardPatch, sha256: sha256(zipGuardPatch), unidiffZero: true },
  { name: "worker-shutdown-fence", bytes: workerShutdownFencePatch, sha256: sha256(workerShutdownFencePatch), unidiffZero: true },
  { name: "linux-worker-socket-path", bytes: linuxWorkerSocketPathPatch, sha256: sha256(linuxWorkerSocketPathPatch), unidiffZero: true },
];

test("applies the session-lease, Windows ZIP guard, worker-shutdown, and Linux worker-socket patches in order", async (t) => {
  const fixture = await makeFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));

  applyReviewedSourcePatches(fixture.root, reviewedPatchSequence);

  assert.equal(
    await readFile(fixture.source, "utf8"),
    'export const state = "base";\nexport const lease = true;\nexport const archiveGuard = true;\nexport const workerSocketPath = true;\nexport const shutdownFence = true;\n',
  );
  assert.equal(runGit(["rev-parse", "HEAD"], fixture.root).length, 40, "the pinned source commit remains unchanged");
  assert.deepEqual(
    runGit(["diff", "--name-only"], fixture.root).split(/\r?\n/),
    ["packages/coding-agent/src/core/session-lease.ts"],
  );
});

test("rejects a mismatched later patch digest before changing the build checkout", async (t) => {
  const fixture = await makeFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const badSequence = [
    reviewedPatchSequence[0],
    reviewedPatchSequence[1],
    { ...reviewedPatchSequence[2], sha256: "0".repeat(64) },
    reviewedPatchSequence[3],
  ];

  assert.throws(() => applyReviewedSourcePatches(fixture.root, badSequence), /worker-shutdown-fence.*SHA-256 mismatch/);
  assert.equal(await readFile(fixture.source, "utf8"), 'export const state = "base";\n');
  assert.equal(runGit(["status", "--porcelain"], fixture.root), "");
});

// This integration seam intentionally guards the real release entrypoint too;
// the Windows CI bundle/native/MSI path supplies the end-to-end verification.
const securityBuildSource = await readFile(new URL("./prepare-prime-agent-security-build.mjs", import.meta.url), "utf8");
const gitattributes = await readFile(new URL("../.gitattributes", import.meta.url), "utf8");
const bundleSource = await readFile(new URL("./bundle.mjs", import.meta.url), "utf8");
const e2eSource = await readFile(new URL("../verify/e2e.mjs", import.meta.url), "utf8");
const windowsCiWorkflow = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
const windowsAclWorkflow = await readFile(new URL("../.github/workflows/windows-dependency-hardening.yml", import.meta.url), "utf8");
test("Windows release workflows bootstrap a SHA-pinned, ACL-validated private checkout before package operations", () => {
  const findStepBlock = (source, stepName, offset = 0) => {
    const start = source.indexOf(`      - name: ${stepName}`, offset);
    assert.ok(start >= 0, `workflow step exists: ${stepName}`);
    const next = source.indexOf("\n      - name: ", start + 1);
    return source.slice(start, next < 0 ? source.length : next);
  };
  const cuaJobOffset = windowsCiWorkflow.indexOf("  cua-e2e:");
  assert.ok(cuaJobOffset > 0, "CI defines the best-effort CUA job");
  const testJob = windowsCiWorkflow.slice(0, cuaJobOffset);
  const cuaJob = windowsCiWorkflow.slice(cuaJobOffset);
  const prepTest = findStepBlock(testJob, "Prepare a secure Windows source checkout");
  const prepCua = findStepBlock(cuaJob, "Prepare a secure Windows source checkout");
  for (const prep of [prepTest, prepCua]) {
    assert.ok(prep.includes("node:os") && prep.includes("tmpdir") && prep.includes("mkdtempSync"), "the checkout uses a unique directory under Node's system TEMP");
    assert.ok(prep.includes("GITHUB_REF") && prep.includes("GITHUB_SHA"), "the event ref is checked out and pinned to its exact SHA");
    assert.ok(prep.includes("assertSecureProjectRoot"), "the secure-root ACL gate runs before package operations");
  }
  const testSteps = [
    "Install dependencies", "Type-check", "Unit tests", "Updater harness (config + keys + signature crypto)",
    "Live update-feed integrity check", "Runtime helper and fail-closed gate regression tests",
    "Platform provenance and Tauri resource tests", "Build complete runtime bundle", "Load production Windows native modules",
    "Focused JSON-RPC wire regression", "Build guarded Tauri MSI", "Verify MIT notice is inside the built MSI",
    "Verify bridge compatibility with the pinned daemon", "End-to-end verification",
  ];
  for (const name of testSteps) {
    assert.ok(findStepBlock(testJob, name).includes("working-directory: ${{ env.SAFE_WINDOWS_REPO }}"), `${name} runs from the validated checkout`);
  }
  const cuaSteps = ["Install dependencies", "Build frontend", "Build actual pinned runtime resources", "Install cua-driver", "Run cua-driver e2e suite"];
  for (const name of cuaSteps) {
    assert.ok(findStepBlock(cuaJob, name).includes("working-directory: ${{ env.SAFE_WINDOWS_REPO }}"), `${name} runs from the validated checkout`);
  }
  assert.ok(findStepBlock(cuaJob, "Build Tauri release exe").includes("working-directory: ${{ env.SAFE_WINDOWS_REPO }}/src-tauri"));

  const aclPrep = findStepBlock(windowsAclWorkflow, "Prepare a secure Windows source checkout");
  assert.ok(aclPrep.includes("GITHUB_REF") && aclPrep.includes("GITHUB_SHA") && aclPrep.includes("assertSecureProjectRoot"));
  assert.ok(windowsAclWorkflow.indexOf("Record actual Windows runner ACLs before policy design") < windowsAclWorkflow.indexOf("Prepare a secure Windows source checkout"),
    "the diagnostic still records the runner workspace ACL before building privately");
  for (const name of [
    "Build dependency overlay under private Windows NTFS ACLs",
    "Run dependency overlay tests on native Windows ACLs",
    "Verify the guarded Windows ZIP installer against pinned Prime Agent source",
  ]) {
    assert.ok(findStepBlock(windowsAclWorkflow, name).includes("working-directory: ${{ env.SAFE_WINDOWS_REPO }}"), `${name} uses the validated checkout`);
  }
});

test("the real bundler prepares and builds the composed security overlay", () => {
  assert.match(bundleSource, /preparePrimeAgentSecurityBuildTree/);
  assert.ok(bundleSource.includes("primeBuild.path"));
  assert.ok(!bundleSource.includes("preparePrimeAgentBuildTree(WORKTREE, primeSource.path)"));
});

test("accepts only exact composed Prime Agent lease, Windows ZIP guard, worker-shutdown, and Linux worker-socket provenance", () => {
  const provenance = {
    ...PRIME_AGENT_SECURITY_BUILD_PROVENANCE_EXPECTED,
    sourceDirectory: "/tmp/prime-agent",
    buildDirectory: "/tmp/prime-agent-v070-security-build",
  };
  assert.deepEqual(provenance.patchOrder, ["session-lease", "windows-zip-guard", "worker-shutdown-fence", "linux-worker-socket-path"]);
  assert.equal(matchesPrimeAgentSecurityBuildProvenance(provenance), true);
  assert.equal(matchesPrimeAgentSecurityBuildProvenance({
    ...provenance,
    windowsZipGuardPatchSha256: "0".repeat(64),
  }), false);
  assert.equal(matchesPrimeAgentSecurityBuildProvenance({
    ...provenance,
    workerShutdownFencePatchSha256: "0".repeat(64),
  }), false);
  assert.equal(matchesPrimeAgentSecurityBuildProvenance({
    ...provenance,
    linuxWorkerSocketPathPatchSha256: "0".repeat(64),
  }), false);
  assert.equal(matchesPrimeAgentSecurityBuildProvenance({
    ...provenance,
    patchOrder: ["windows-zip-guard", "session-lease", "linux-worker-socket-path", "worker-shutdown-fence"],
  }), false);
});


test("the real bundle runs all composed Prime Agent security regression suites", () => {
  assert.ok(bundleSource.includes("daemon-supervisor-monitor.test.ts"));
  assert.ok(bundleSource.includes("session-lease.test.ts"));
  assert.ok(bundleSource.includes("tools-manager.test.ts"));
  assert.ok(bundleSource.includes('"node_modules", "vitest", "vitest.mjs"'));
  assert.ok(bundleSource.includes('cwd: join(primeAgentRoot, "packages", "coding-agent")'));
  assert.ok(bundleSource.includes("shell: false"));
  assert.ok(bundleSource.includes("await buildPinnedDaemon(primeBuild.path, primeSource.path)"));
  assert.ok(bundleSource.includes("verifyPrimeAgentSecurityBuildTree(projectRoot, primeAgentRoot, primeSourceRoot)"));
  const install = bundleSource.indexOf('label: "Prime Agent locked dependency install (normal lifecycle)"');
  const verify = bundleSource.indexOf('verifyPrimeAgentBuildStage(WORKTREE, primeAgentRoot, primeSourceRoot, "npm ci")');
  const tests = bundleSource.indexOf('label: "Prime Agent session-lease, Windows ZIP guard, worker-shutdown fence, and Linux worker-socket path regression tests"');
  assert.ok(install >= 0 && verify > install && tests > verify, "build output is reverified after npm ci and before tests");
  for (const stage of ["Prime Agent regression tests", "TUI build", "AI build", "agent-core build", "daemon build"]) {
    assert.ok(bundleSource.includes(`verifyPrimeAgentBuildStage(WORKTREE, primeAgentRoot, primeSourceRoot, "${stage}")`));
  }
  const productionInstall = bundleSource.indexOf('runNpm(["ci", "--omit=dev", "--ignore-scripts"]');
  const productionInstallLabel = bundleSource.indexOf('label: "Prime Agent production dependency tree (lifecycle deferred)"');
  const productionCiVerify = bundleSource.indexOf('verifyPrimeAgentBuildStage(WORKTREE, primeBuild.path, primeSource.path, "npm ci --omit=dev --ignore-scripts")');
  const productionRebuild = bundleSource.indexOf('runNpm(["rebuild", "--omit=dev"]');
  const productionRebuildLabel = bundleSource.indexOf('label: "Prime Agent production dependency lifecycle scripts"');
  const productionRebuildVerify = bundleSource.indexOf('verifyPrimeAgentBuildStage(WORKTREE, primeBuild.path, primeSource.path, "npm rebuild --omit=dev")');
  const stage = bundleSource.indexOf('await cp(join(primeBuild.path, "node_modules")');
  assert.ok(productionInstall >= 0
    && productionInstallLabel > productionInstall
    && productionCiVerify > productionInstallLabel
    && productionRebuild > productionCiVerify
    && productionRebuildLabel > productionRebuild
    && productionRebuildVerify > productionRebuildLabel
    && stage > productionRebuildVerify,
  "the exact production lock is installed, production lifecycle scripts are replayed, and both stages are provenance-verified before staging");
  assert.equal(bundleSource.includes('runNpm(["prune", "--omit=dev"]'), false, "do not let npm prune rewrite platform-specific lock metadata");
});

test("Windows build output path comparisons ignore case but POSIX comparisons do not", () => {
  assert.equal(samePath("C:/Temp/Sophos/.deps", "c:/temp/sophos/.deps", "win32"), true);
  assert.equal(samePath("C:/Temp/Sophos/.deps", "C:/Temp/Sophos/other", "win32"), false);
  assert.equal(samePath("/tmp/Build", "/tmp/build", "linux"), false);
});

test("Windows Prime Agent source and build trees use a unique system-TEMP root", () => {
  const projectRoot = "D:/a/sophos/repo";
  const systemTempRoot = "C:/Users/runneradmin/AppData/Local/Temp";
  const privateTempRoot = `${systemTempRoot}/sophos-prime-agent-security-abc123`;
  const winPaths = resolvePrimeAgentSecurityWorkPaths(projectRoot, {
    platform: "win32",
    systemTempRoot,
    privateTempRoot,
  });
  assert.equal(samePath(winPaths.sourceRoot, `${privateTempRoot}/source`, "win32"), true);
  assert.equal(samePath(winPaths.buildRoot, `${privateTempRoot}/build`, "win32"), true);
  assert.equal(samePath(winPaths.sourceRoot, winPaths.buildRoot, "win32"), false);
  assert.throws(() => resolvePrimeAgentSecurityWorkPaths(projectRoot, {
    platform: "win32",
    systemTempRoot,
    privateTempRoot: "D:/a/sophos/repo/.deps",
  }), /under system TEMP/);
  assert.throws(() => resolvePrimeAgentSecurityWorkPaths(projectRoot, {
    platform: "win32",
    systemTempRoot,
  }), /unique private temp root/);
  const linuxPaths = resolvePrimeAgentSecurityWorkPaths("/work/sophos", { platform: "linux" });
  assert.equal(linuxPaths.sourceRoot, "/work/sophos/.deps/prime-agent");
  assert.equal(linuxPaths.buildRoot, "/work/sophos/.deps/prime-agent-v070-security-build");
});

test("hash-pinned overlay policy files keep their committed bytes on Windows checkouts", () => {
  assert.match(gitattributes, /^scripts\/dependency-hardening-overlay\.json -text$/m);
  assert.match(gitattributes, /^patches\/prime-agent-v0\.7\.0-session-lease-windows\.patch -text$/m);
  assert.match(gitattributes, /^patches\/prime-agent-v0\.7\.0-linux-worker-socket-path\.patch -text$/m);
  assert.match(gitattributes, /^patches\/prime-agent-v0\.7\.0-worker-shutdown-fence\.patch -text$/m);
});

test("checked-out worker-shutdown patch retains the exact reviewed bytes", async () => {
  const patchBytes = await readFile(new URL("../patches/prime-agent-v0.7.0-worker-shutdown-fence.patch", import.meta.url));
  assert.equal(patchBytes.length, PRIME_AGENT_SECURITY_BUILD_PROVENANCE_EXPECTED.workerShutdownFencePatchBytes);
  assert.equal(sha256(patchBytes), PRIME_AGENT_SECURITY_BUILD_PROVENANCE_EXPECTED.workerShutdownFencePatchSha256);
  const patch = patchBytes.toString("utf8");
  assert.ok(patch.includes("getSupervisorLaunchLockDirectory"), "Windows named-pipe recovery lock uses filesystem storage");
  assert.ok(patch.includes("keeps the replacement lock in filesystem storage for named-pipe sockets"), "the source regression remains in the patch");
  assert.ok(patch.includes("gracefulTimeoutMs = 2000"), "ordinary worker stops keep their existing grace period");
  assert.ok(patch.includes("@@ -4497,0 +4498 @@\n+\t\tgracefulTimeoutMs = 2000,"), "the shutdown hunk retains its zero-context insertion point before the Linux socket patch shifts later lines");
  assert.ok(patch.includes("forceWorkers, true, false, undefined, 30000"), "daemon shutdown allows adopted session workers time to archive and exit");
  assert.ok(patch.includes("force ? 500 : gracefulTimeoutMs"), "the longer timeout is applied only to unforced graceful worker shutdown");
});

test("checked-out Linux worker-socket path patch retains the exact reviewed bytes", async () => {
  const patchBytes = await readFile(new URL("../patches/prime-agent-v0.7.0-linux-worker-socket-path.patch", import.meta.url));
  assert.equal(patchBytes.length, PRIME_AGENT_SECURITY_BUILD_PROVENANCE_EXPECTED.linuxWorkerSocketPathPatchBytes);
  assert.equal(sha256(patchBytes), PRIME_AGENT_SECURITY_BUILD_PROVENANCE_EXPECTED.linuxWorkerSocketPathPatchSha256);
  assert.match(patchBytes.toString("utf8"), /w-\$\{workerKey\}\.sock/);
  assert.match(patchBytes.toString("utf8"), /slice\(0, 20\)/);
});

test("Windows supervisor-monitor fixture uses platform temp and deterministic drain admission", async () => {
  const patch = await readFile(new URL("../patches/prime-agent-v0.7.0-worker-shutdown-fence.patch", import.meta.url), "utf8");
  assert.ok(patch.includes("mkdtempSync(join(tmpdir(), `prime-update-drain-${process.pid}-`))"));
  assert.ok(patch.includes("const socketPath = process.platform === \"win32\""));
  assert.ok(patch.includes("prime-agent-update-drain-${process.pid}"));
  assert.ok(patch.includes("await vi.waitFor(() => expect(Reflect.get(supervisor, \"updateRestartPhase\")).toBe(\"draining\"), { timeout: 5000 });"));
  assert.ok(patch.includes("mutationDrain.begin();"));
  assert.ok(patch.includes('error: "Unknown active session: missing"'));
  assert.ok(patch.includes("-\t\tconst root = mkdtempSync(`/tmp/prime-update-drain-${process.pid}-`);"));
});

test("checked-out overlay manifest retains the exact reviewed bytes", async (t) => {
  const manifestBytes = await readFile(new URL("./dependency-hardening-overlay.json", import.meta.url));
  const manifestSha256 = sha256(manifestBytes);
  const carriageReturns = manifestBytes.filter((byte) => byte === 0x0d).length;
  const diagnostics = `manifest checkout: bytes=${manifestBytes.length}, sha256=${manifestSha256}, CR bytes=${carriageReturns}`;
  t.diagnostic(diagnostics);
  assert.equal(
    manifestSha256,
    PRIME_AGENT_SECURITY_BUILD_PROVENANCE_EXPECTED.overlayManifestSha256,
    `${diagnostics}; raw manifest bytes must match the reviewed digest without normalization`,
  );
  assert.equal(carriageReturns, 0, `${diagnostics}; checked-out manifest must remain LF-only`);
});

test("Windows real bundler allocates source and build paths in the validated system-TEMP root", () => {
  assert.ok(bundleSource.includes('mkdtemp(join(systemTempRoot, "sophos-prime-agent-security-"))'));
  assert.ok(bundleSource.includes('const systemTempRoot = process.platform === "win32" ? await realpath(tmpdir()) : tmpdir()'));
  assert.ok(bundleSource.includes("resolvePrimeAgentSecurityWorkPaths"));
  assert.ok(bundleSource.includes("primePaths.sourceRoot"));
  assert.ok(bundleSource.includes("primePaths.buildRoot"));
  assert.ok(bundleSource.includes("const primeSourceRoot = process.env.PRIME_AGENT_REF ?? primePaths.sourceRoot"));
  assert.ok(bundleSource.includes("preparePrimeAgentSecurityBuildTree(WORKTREE, primeSource.path, primePaths.buildRoot, systemTempRoot)"));
  assert.ok(securityBuildSource.includes('const systemTempRoot = process.platform === "win32" ? await realpath(tmpdir()) : undefined;'));
  assert.ok(e2eSource.includes("await verifyPrimeAgentSecurityBuildTree(REPO, buildDirectory, sourceDirectory)"));
  assert.ok(!bundleSource.includes("systemTempDirectory"), "do not expose ephemeral CI temp paths in the bundle manifest");
});

test("build hash mismatch diagnostics identify only changed files and both hashes", async () => {
  const { describeBuildHashMismatches } = await import("./prepare-prime-agent-security-build.mjs");
  assert.equal(typeof describeBuildHashMismatches, "function");
  assert.deepEqual(
    describeBuildHashMismatches(
      { "package-lock.json": "actual-lock", LICENSE: "matching-license" },
      { "package-lock.json": "expected-lock", LICENSE: "matching-license" },
    ),
    [{ file: "package-lock.json", expected: "expected-lock", actual: "actual-lock" }],
  );
});

test("build lock byte diagnostics report exact hashes, EOL counts, semantic equality and first byte change", async () => {
  const { describeBuildInputBytes } = await import("./prepare-prime-agent-security-build.mjs");
  assert.equal(typeof describeBuildInputBytes, "function");
  const expected = Buffer.from('{"lock":1}\n');
  const actual = Buffer.from('{"lock":1}\r\n');
  const report = describeBuildInputBytes(expected, actual);
  assert.deepEqual(report.expected, {
    bytes: expected.length,
    sha256: sha256(expected),
    crBytes: 0,
    lfBytes: 1,
    crlfPairs: 0,
  });
  assert.deepEqual(report.actual, {
    bytes: actual.length,
    sha256: sha256(actual),
    crBytes: 1,
    lfBytes: 1,
    crlfPairs: 1,
  });
  assert.equal(report.byteDifferences, 2);
  assert.deepEqual(report.firstDifference, {
    offset: expected.length - 1,
    expectedByte: 0x0a,
    actualByte: 0x0d,
  });
  assert.equal(report.jsonSemanticallyEqual, true);
});
