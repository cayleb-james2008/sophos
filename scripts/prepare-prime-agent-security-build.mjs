#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { lstat, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, posix, relative, resolve, sep, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { isDeepStrictEqual } from "node:util";
import {
  assertRegularFileNoSymlink,
  assertSecureProjectRoot,
  assertSecureSourceRoot,
  canonicalizeOverlayLockBytes,
  prepareDependencyOverlay,
} from "./prepare-dependency-overlay.mjs";
import { PRIME_AGENT_SESSION_LEASE_OVERLAY } from "./apply-prime-agent-overlay.mjs";
import { PRIME_AGENT_PIN } from "./runtime-pins.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROJECT_ROOT = resolve(SCRIPT_DIR, "..");
const BUILD_DIRECTORY = ".deps/prime-agent-v070-security-build";
const BUILD_MARKER = ".sophos-prime-agent-security-build.json";
const EXPECTED = Object.freeze({
  sourceRepository: "https://github.com/PrimeIntellect-ai/prime-agent.git",
  sourceCommit: "be9e2fa0714e7cd1c6bd9bdb1b554d2cc6550387",
  sourceVersion: "0.7.0",
  sourceLicense: "MIT",
  sourceRootPackageJsonSha256: "071f2a9bc6ca8fc2a82f62824c03e9b7f07d7beaa2b001973595f34061ce37b4",
  sourceCodingAgentPackageJsonSha256: "e25b1ddeb2ecc2288d45e8a49ba2b9e1682068b651820fab5f59c91b751b6ffc",
  sourcePackageLockSha256: "b2ac9fb79434f082d4a4e84fb4671cdd7e1357c7cd0687e987fddcaff1dd9d6e",
  licenseSha256: "b288615fb31dc504623582fb790a28e6d86bc2f5c1396845af555e43386da5a0",
  overlayManifestSha256: "eb6e29b78767d6b699c1e3387bda5fd70037e65ebc3782418cf0d83e2a091ba9",
  overlayPackageJsonSha256: "c2014bd6f87bd0d0f758a02e090dfc7741928ee67ae6746d6e2712d02357c3b4",
  overlayLockSha256: "725ef9e8b2035e4e6f1b77d44b3ca95440bb20f702825c159294e42a92840e3f",
  leasePatchSha256: "ad532cd1e52dd1e6e05bb3e8fd788cf73aee6ecb6be955c38dc43c042f3d8a27",
  leaseSourceSha256: "78ae066a92f101771875a9d566549761ab459aaa4c7f6ce1de087cc00a6e462a",
  leasePatchedSourceSha256: "006802f39f6de128e6b7f418e9fb3b2793ef73410d1247db562ce5dcbe7a0349",
  zipGuardPatchSha256: "e06fa63df26c0e52e699459a0adf284cb032dc88828abc20bfa5a220de681b48",
  zipGuardPatchBytes: 7632,
  workerShutdownFencePatchSha256: "49174be99b55bba9a1b028d59879f241384517dec8669933ac9aa446da6b38ce",
  workerShutdownFencePatchBytes: 6649,
  overlayId: "prime-agent-v070-windows-session-lease-v1",
  overrides: {
    undici: "7.29.1",
    "brace-expansion": "5.0.12",
    "ip-address": "10.7.1",
    protobufjs: "7.6.5",
  },
});

const EXPECTED_TRACKED_CHANGES = [
  "package-lock.json",
  "package.json",
  "packages/coding-agent/src/core/session-lease.ts",
  "packages/coding-agent/src/modes/daemon/daemon-mode.ts",
  "packages/coding-agent/src/utils/tools-manager.ts",
  "packages/coding-agent/test/daemon-supervisor-monitor.test.ts",
  "packages/coding-agent/test/tools-manager.test.ts",
].sort();
const EXPECTED_PATCH_ORDER = Object.freeze(["session-lease", "windows-zip-guard", "worker-shutdown-fence"]);
const ALLOWED_PATCH_OUTPUTS = new Set([
  "packages/coding-agent/src/core/session-lease.ts",
  "packages/coding-agent/src/modes/daemon/daemon-mode.ts",
  "packages/coding-agent/src/utils/tools-manager.ts",
  "packages/coding-agent/test/daemon-supervisor-monitor.test.ts",
  "packages/coding-agent/test/tools-manager.test.ts",
]);
const EXPECTED_BUILD_SOURCE_HASHES = Object.freeze({
  "packages/coding-agent/src/core/session-lease.ts": "006802f39f6de128e6b7f418e9fb3b2793ef73410d1247db562ce5dcbe7a0349",
  "packages/coding-agent/src/modes/daemon/daemon-mode.ts": "61ffac40905989f869b6981b181518fc720b968dbb103d4639b9cdedf8dba441",
  "packages/coding-agent/src/utils/tools-manager.ts": "8936f99a387c3426bf4f2210cc1178fec1dcc2605cccab5d93127054340c7064",
  "packages/coding-agent/test/daemon-supervisor-monitor.test.ts": "e0d9791125fe5823e3dd91415c9c6d269c0c3cb17b053666e1e451e05d67c6b2",
  "packages/coding-agent/test/tools-manager.test.ts": "0956ee19088f761770601ff1c00212717c6a7276dd733dc3079c05d4235e8b75",
});

export function samePath(left, right, platform = process.platform) {
  if (platform === "win32") return win32.normalize(left).toLowerCase() === win32.normalize(right).toLowerCase();
  return resolve(left) === resolve(right);
}

function isWindowsChild(parent, child) {
  const relativePath = win32.relative(win32.resolve(parent), win32.resolve(child));
  return relativePath !== ""
    && relativePath !== ".."
    && !relativePath.startsWith(`..${win32.sep}`)
    && !win32.isAbsolute(relativePath);
}

export function resolvePrimeAgentSecurityBuildRoot(projectRoot, requestedBuildRoot, options = {}) {
  const platform = options.platform ?? process.platform;
  const root = platform === "win32" ? win32.resolve(projectRoot) : resolve(projectRoot);
  if (platform === "win32") {
    const systemTempRoot = options.systemTempRoot;
    const candidate = requestedBuildRoot ? win32.resolve(requestedBuildRoot) : "";
    if (typeof systemTempRoot !== "string" || !requestedBuildRoot || !isWindowsChild(systemTempRoot, candidate)) {
      throw new Error("Windows security build output must be under the canonical validated system TEMP root");
    }
    return candidate;
  }
  const candidate = requestedBuildRoot ? resolve(requestedBuildRoot) : resolve(root, BUILD_DIRECTORY);
  normalizeRelative(root, candidate);
  return candidate;
}

export function resolvePrimeAgentSecurityWorkPaths(projectRoot, options = {}) {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") {
    const root = posix.resolve(projectRoot);
    return {
      sourceRoot: posix.resolve(root, ".deps", "prime-agent"),
      buildRoot: posix.resolve(root, BUILD_DIRECTORY),
    };
  }
  const systemTempRoot = options.systemTempRoot;
  const privateTempRoot = options.privateTempRoot;
  if (typeof systemTempRoot !== "string" || typeof privateTempRoot !== "string"
    || !isWindowsChild(systemTempRoot, privateTempRoot)) {
    throw new Error("Windows Prime Agent security build requires a unique private temp root under system TEMP");
  }
  const sourceRoot = win32.join(win32.resolve(privateTempRoot), "source");
  const buildRoot = resolvePrimeAgentSecurityBuildRoot(
    projectRoot,
    win32.join(win32.resolve(privateTempRoot), "build"),
    { platform, systemTempRoot },
  );
  return { sourceRoot, buildRoot };
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function describeBuildInputBytes(expectedBytes, actualBytes) {
  if (!Buffer.isBuffer(expectedBytes) || !Buffer.isBuffer(actualBytes)) {
    throw new TypeError("build input byte diagnostics require Buffer values");
  }
  const stats = (bytes) => {
    let crBytes = 0;
    let lfBytes = 0;
    let crlfPairs = 0;
    for (let index = 0; index < bytes.length; index += 1) {
      if (bytes[index] === 0x0d) {
        crBytes += 1;
        if (bytes[index + 1] === 0x0a) crlfPairs += 1;
      }
      if (bytes[index] === 0x0a) lfBytes += 1;
    }
    return { bytes: bytes.length, sha256: sha256(bytes), crBytes, lfBytes, crlfPairs };
  };
  let firstDifference = null;
  let byteDifferences = 0;
  for (let offset = 0; offset < Math.max(expectedBytes.length, actualBytes.length); offset += 1) {
    const expectedByte = offset < expectedBytes.length ? expectedBytes[offset] : null;
    const actualByte = offset < actualBytes.length ? actualBytes[offset] : null;
    if (expectedByte !== actualByte) {
      byteDifferences += 1;
      if (firstDifference === null) firstDifference = { offset, expectedByte, actualByte };
    }
  }
  let jsonSemanticallyEqual = null;
  try {
    jsonSemanticallyEqual = isDeepStrictEqual(
      JSON.parse(expectedBytes.toString("utf8")),
      JSON.parse(actualBytes.toString("utf8")),
    );
  } catch {
    // Raw-byte diagnostics remain useful when the changed input is not valid JSON.
  }
  return {
    expected: stats(expectedBytes),
    actual: stats(actualBytes),
    byteDifferences,
    firstDifference,
    jsonSemanticallyEqual,
  };
}

function runGit(args, cwd, input) {
  const result = spawnSync("git", args, {
    cwd,
    input,
    encoding: "utf8",
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  if (result.error) throw new Error(`git ${args.join(" ")} could not start: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = `${result.stderr ?? ""}${result.stdout ?? ""}`.trim();
    throw new Error(`git ${args.join(" ")} failed (${result.status})${detail ? `: ${detail}` : ""}`);
  }
  return (result.stdout ?? "").trim();
}

function normalizeRelative(parent, child) {
  const rel = relative(parent, child);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error("Prime Agent security build output must be inside the Sophos project tree");
  }
  return rel.split(sep).join("/");
}

function assertExpectedSourceIdentity(checkout) {
  const head = runGit(["rev-parse", "HEAD"], checkout);
  const origin = runGit(["remote", "get-url", "origin"], checkout);
  if (head !== EXPECTED.sourceCommit || origin !== EXPECTED.sourceRepository) {
    throw new Error("Prime Agent security build checkout does not match the exact pinned public source");
  }
  return { head, origin };
}

function assertPatchRecords(patches) {
  if (!Array.isArray(patches) || patches.length !== 3) {
    throw new Error("the security composition requires exactly three reviewed source patches");
  }
  const names = patches.map((patch) => patch?.name);
  if (!isDeepStrictEqual(names, EXPECTED_PATCH_ORDER)) {
    throw new Error("reviewed source patches must be ordered session-lease then Windows ZIP guard");
  }
  for (const patch of patches) {
    if (!Buffer.isBuffer(patch.bytes)) throw new Error(`${patch.name} patch bytes must be a Buffer`);
    if (!/^[a-f0-9]{64}$/.test(patch.sha256)) throw new Error(`${patch.name} patch SHA-256 is malformed`);
    if (sha256(patch.bytes) !== patch.sha256) throw new Error(`${patch.name} patch SHA-256 mismatch`);
    if (typeof patch.unidiffZero !== "boolean") throw new Error(`${patch.name} unidiffZero policy must be explicit`);
  }
}

/** Apply verified source patches in their declared order without touching source checkout. */
export function applyReviewedSourcePatches(buildRoot, patches) {
  assertPatchRecords(patches);
  for (const patch of patches) {
    const zeroContext = patch.unidiffZero ? ["--unidiff-zero"] : [];
    runGit(["apply", ...zeroContext, "--check", "-"], buildRoot, patch.bytes);
    runGit(["apply", ...zeroContext, "-"], buildRoot, patch.bytes);
  }
  runGit(["diff", "--check"], buildRoot);
}

async function withGitAutocrlfDisabled(operation) {
  const countRaw = process.env.GIT_CONFIG_COUNT ?? "0";
  if (!/^(0|[1-9]\d*)$/.test(countRaw)) throw new Error("GIT_CONFIG_COUNT is invalid; refusing to alter Git checkout policy");
  const index = Number(countRaw);
  if (!Number.isSafeInteger(index)) throw new Error("GIT_CONFIG_COUNT is too large");
  const keys = ["GIT_CONFIG_COUNT", `GIT_CONFIG_KEY_${index}`, `GIT_CONFIG_VALUE_${index}`];
  const saved = new Map(keys.map((key) => [key, Object.hasOwn(process.env, key) ? process.env[key] : undefined]));
  process.env.GIT_CONFIG_COUNT = String(index + 1);
  process.env[`GIT_CONFIG_KEY_${index}`] = "core.autocrlf";
  process.env[`GIT_CONFIG_VALUE_${index}`] = "false";
  try {
    return await operation();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function loadReviewedInputs(projectRoot) {
  const manifestPath = await assertRegularFileNoSymlink(
    projectRoot,
    ["scripts", "dependency-hardening-overlay.json"],
    "dependency overlay manifest",
  );
  const lockPath = await assertRegularFileNoSymlink(
    projectRoot,
    ["scripts", "dependency-hardening", "prime-agent-package-lock.json"],
    "dependency overlay lock",
  );
  const leasePatchPath = await assertRegularFileNoSymlink(
    projectRoot,
    ["patches", "prime-agent-v0.7.0-session-lease-windows.patch"],
    "Prime Agent session-lease patch",
  );
  const zipGuardEncodedPath = await assertRegularFileNoSymlink(
    projectRoot,
    ["scripts", "dependency-hardening", "prime-agent-windows-zip-guard.patch.b64"],
    "Prime Agent Windows ZIP guard patch payload",
  );
  const workerShutdownFencePatchPath = await assertRegularFileNoSymlink(
    projectRoot,
    ["patches", "prime-agent-v0.7.0-worker-shutdown-fence.patch"],
    "Prime Agent worker-shutdown fence patch",
  );

  const manifestBytes = await readFile(manifestPath);
  if (sha256(manifestBytes) !== EXPECTED.overlayManifestSha256) {
    throw new Error("dependency overlay manifest SHA-256 mismatch");
  }
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const lockBytes = canonicalizeOverlayLockBytes(await readFile(lockPath), EXPECTED.overlayLockSha256);
  if (manifest.overlayLockSha256 !== EXPECTED.overlayLockSha256
    || manifest.source?.repository !== EXPECTED.sourceRepository
    || manifest.source?.commit !== EXPECTED.sourceCommit
    || manifest.source?.version !== EXPECTED.sourceVersion
    || manifest.source?.license !== EXPECTED.sourceLicense
    || manifest.source?.rootPackageJsonSha256 !== EXPECTED.sourceRootPackageJsonSha256
    || manifest.source?.codingAgentPackageJsonSha256 !== EXPECTED.sourceCodingAgentPackageJsonSha256
    || manifest.source?.packageLockSha256 !== EXPECTED.sourcePackageLockSha256
    || manifest.source?.licenseSha256 !== EXPECTED.licenseSha256
    || manifest.registry !== "https://registry.npmjs.org/") {
    throw new Error("dependency overlay manifest does not match the reviewed Prime Agent source or lock pins");
  }
  const actualOverrides = Object.fromEntries(
    Object.entries(manifest.overrides ?? {}).map(([name, pin]) => [name, pin?.version]),
  );
  if (!isDeepStrictEqual(actualOverrides, EXPECTED.overrides)) {
    throw new Error("dependency overlay override versions do not match the reviewed compatible pins");
  }
  const leasePatchBytes = await readFile(leasePatchPath);
  if (sha256(leasePatchBytes) !== EXPECTED.leasePatchSha256
    || PRIME_AGENT_SESSION_LEASE_OVERLAY.patchSha256 !== EXPECTED.leasePatchSha256
    || PRIME_AGENT_SESSION_LEASE_OVERLAY.sourceSha256 !== EXPECTED.leaseSourceSha256
    || PRIME_AGENT_SESSION_LEASE_OVERLAY.patchedSourceSha256 !== EXPECTED.leasePatchedSourceSha256) {
    throw new Error("Prime Agent session-lease source patch provenance does not match PR9");
  }
  const encodedGuard = (await readFile(zipGuardEncodedPath, "utf8")).trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encodedGuard)) {
    throw new Error("Windows ZIP guard payload is not canonical base64");
  }
  const zipGuardPatchBytes = Buffer.from(encodedGuard, "base64");
  if (zipGuardPatchBytes.toString("base64") !== encodedGuard
    || zipGuardPatchBytes.length !== EXPECTED.zipGuardPatchBytes
    || sha256(zipGuardPatchBytes) !== EXPECTED.zipGuardPatchSha256) {
    throw new Error("decoded Windows ZIP guard patch SHA-256 or size mismatch");
  }
  const workerShutdownFencePatchBytes = await readFile(workerShutdownFencePatchPath);
  if (workerShutdownFencePatchBytes.length !== EXPECTED.workerShutdownFencePatchBytes
    || sha256(workerShutdownFencePatchBytes) !== EXPECTED.workerShutdownFencePatchSha256) {
    throw new Error("worker-shutdown fence patch SHA-256 or size mismatch");
  }
  if (sha256(lockBytes) !== EXPECTED.overlayLockSha256) {
    throw new Error("canonical dependency overlay lock SHA-256 mismatch");
  }
  return {
    manifest,
    manifestSha256: EXPECTED.overlayManifestSha256,
    lockBytes,
    lockSha256: sha256(lockBytes),
    leasePatchBytes,
    zipGuardPatchBytes,
    workerShutdownFencePatchBytes,
  };
}

function expectedMarker(inputs) {
  return {
    schemaVersion: 1,
    sourceRepository: EXPECTED.sourceRepository,
    sourceCommit: EXPECTED.sourceCommit,
    sourceVersion: EXPECTED.sourceVersion,
    sourceLicense: EXPECTED.sourceLicense,
    sourcePackageLockSha256: EXPECTED.sourcePackageLockSha256,
    overlayManifestSha256: inputs.manifestSha256,
    overlayPackageJsonSha256: EXPECTED.overlayPackageJsonSha256,
    overlayLockSha256: inputs.lockSha256,
    sessionLeasePatchSha256: EXPECTED.leasePatchSha256,
    windowsZipGuardPatchSha256: EXPECTED.zipGuardPatchSha256,
    windowsZipGuardPatchBytes: EXPECTED.zipGuardPatchBytes,
    workerShutdownFencePatchSha256: EXPECTED.workerShutdownFencePatchSha256,
    workerShutdownFencePatchBytes: EXPECTED.workerShutdownFencePatchBytes,
    patchOrder: [...EXPECTED_PATCH_ORDER],
  };
}

export const PRIME_AGENT_SECURITY_BUILD_PROVENANCE_EXPECTED = Object.freeze({
  ...expectedMarker({
    manifestSha256: EXPECTED.overlayManifestSha256,
    lockSha256: EXPECTED.overlayLockSha256,
  }),
  sourceFileHashes: EXPECTED_BUILD_SOURCE_HASHES,
  sourceFiles: EXPECTED_BUILD_SOURCE_HASHES,
  patchedTrackedFiles: EXPECTED_TRACKED_CHANGES,
  immutableSourcePreserved: true,
});

export function matchesPrimeAgentSecurityBuildProvenance(provenance) {
  if (!provenance || typeof provenance !== "object" || Array.isArray(provenance)) return false;
  if (!Object.entries(PRIME_AGENT_SECURITY_BUILD_PROVENANCE_EXPECTED)
    .every(([key, value]) => isDeepStrictEqual(provenance[key], value))) return false;
  return typeof provenance.sourceDirectory === "string" && typeof provenance.buildDirectory === "string";
}

async function fileHash(root, relativePath) {
  const parts = relativePath.split("/");
  const path = await assertRegularFileNoSymlink(root, parts, `Prime Agent build output ${relativePath}`);
  return sha256(await readFile(path));
}

export function describeBuildHashMismatches(actualHashes, expectedHashes) {
  return Object.entries(expectedHashes).flatMap(([file, expected]) => {
    const actual = Object.hasOwn(actualHashes, file) ? actualHashes[file] : "<missing>";
    return actual === expected ? [] : [{ file, expected, actual }];
  });
}

async function assertBuildOutputFiles(buildRoot, marker = null, expectedLockBytes) {
  if (!Buffer.isBuffer(expectedLockBytes)) {
    throw new TypeError("Prime Agent build verification requires the canonical reviewed lock bytes");
  }
  const provenance = assertExpectedSourceIdentity(buildRoot);
  const changedFiles = runGit(["diff", "--name-only"], buildRoot).split(/\r?\n/).filter(Boolean).sort();
  if (!isDeepStrictEqual(changedFiles, EXPECTED_TRACKED_CHANGES)) {
    throw new Error(`Prime Agent security build changed unexpected tracked files: ${changedFiles.join(", ")}`);
  }
  if (runGit(["diff", "--cached", "--name-only"], buildRoot)) {
    throw new Error("Prime Agent security build has unexpected staged files");
  }
  const packageJsonHash = await fileHash(buildRoot, "package.json");
  const lockPath = await assertRegularFileNoSymlink(
    buildRoot,
    ["package-lock.json"],
    "Prime Agent build output package-lock.json",
  );
  const lockBytes = await readFile(lockPath);
  const lockHash = sha256(lockBytes);
  const licenseHash = await fileHash(buildRoot, "LICENSE");
  const leaseSourceHash = await fileHash(buildRoot, PRIME_AGENT_SESSION_LEASE_OVERLAY.sourcePath);
  const inputHashMismatches = describeBuildHashMismatches(
    {
      "package.json": packageJsonHash,
      "package-lock.json": lockHash,
      LICENSE: licenseHash,
      [PRIME_AGENT_SESSION_LEASE_OVERLAY.sourcePath]: leaseSourceHash,
    },
    {
      "package.json": EXPECTED.overlayPackageJsonSha256,
      "package-lock.json": EXPECTED.overlayLockSha256,
      LICENSE: EXPECTED.licenseSha256,
      [PRIME_AGENT_SESSION_LEASE_OVERLAY.sourcePath]: EXPECTED.leasePatchedSourceSha256,
    },
  );
  if (inputHashMismatches.length > 0) {
    let detail = inputHashMismatches
      .map(({ file, expected, actual }) => `${file}: expected ${expected}, got ${actual}`)
      .join("; ");
    if (inputHashMismatches.some(({ file }) => file === "package-lock.json")) {
      detail += `; package-lock raw-byte diagnostics=${JSON.stringify(describeBuildInputBytes(expectedLockBytes, lockBytes))}`;
    }
    throw new Error(`Prime Agent build input SHA-256 mismatch (${detail})`);
  }
  const sourceFileHashes = {};
  for (const path of [...ALLOWED_PATCH_OUTPUTS].sort()) sourceFileHashes[path] = await fileHash(buildRoot, path);
  if (!isDeepStrictEqual(sourceFileHashes, EXPECTED_BUILD_SOURCE_HASHES)) {
    throw new Error("Prime Agent security build source files differ from the reviewed composed patch outputs");
  }
  if (marker && !isDeepStrictEqual(marker.sourceFileHashes, sourceFileHashes)) {
    throw new Error("existing Prime Agent security build source hashes drifted");
  }
  return { provenance, packageJsonHash, lockHash, licenseHash, sourceFileHashes, changedFiles };
}

async function readExistingMarker(buildRoot, baseMarker, expectedLockBytes) {
  await assertSecureSourceRoot(buildRoot, "existing Prime Agent security build output");
  const markerPath = await assertRegularFileNoSymlink(buildRoot, [BUILD_MARKER], "security build ownership marker");
  const marker = JSON.parse(await readFile(markerPath, "utf8"));
  const baseKeys = Object.keys(baseMarker).sort();
  const markerBase = Object.fromEntries(baseKeys.map((key) => [key, marker[key]]));
  if (!isDeepStrictEqual(markerBase, baseMarker)) {
    throw new Error(`refusing to replace an unowned or differently pinned Prime Agent security build at ${buildRoot}`);
  }
  const { sourceFileHashes } = await assertBuildOutputFiles(buildRoot, marker, expectedLockBytes);
  if (!isDeepStrictEqual(Object.keys(marker.sourceFileHashes ?? {}).sort(), [...ALLOWED_PATCH_OUTPUTS].sort())) {
    throw new Error("existing Prime Agent security build marker has unexpected patch outputs");
  }
  const untracked = runGit(["ls-files", "--others", "--exclude-standard"], buildRoot).split(/\r?\n/).filter(Boolean).sort();
  if (!isDeepStrictEqual(untracked, [BUILD_MARKER])) {
    throw new Error("existing Prime Agent security build contains unexpected untracked files");
  }
  const current = await realpath(buildRoot);
  if (samePath(current, resolve(buildRoot))) return { marker, sourceFileHashes, markerPath };
  throw new Error("existing Prime Agent security build path changed during verification");
}

async function removeExistingBuild(buildRoot, baseMarker, expectedLockBytes) {
  if (!existsSync(buildRoot)) return;
  const details = await lstat(buildRoot);
  if (details.isSymbolicLink() || !details.isDirectory()) {
    throw new Error(`refusing to replace a symlink or non-directory security build output: ${buildRoot}`);
  }
  const verified = await readExistingMarker(buildRoot, baseMarker, expectedLockBytes);
  const currentMarker = JSON.parse(await readFile(verified.markerPath, "utf8"));
  if (!isDeepStrictEqual(currentMarker, verified.marker)) {
    throw new Error("Prime Agent security build marker changed during verification");
  }
  await rm(buildRoot, { recursive: true, force: true });
}

function withBuildMarker(baseMarker, sourceFileHashes) {
  return { ...baseMarker, sourceFileHashes };
}

export async function verifyPrimeAgentSecurityBuildTree(projectRoot, buildRoot, pinnedSourceRoot) {
  const root = await assertSecureProjectRoot(projectRoot);
  const source = await assertSecureSourceRoot(pinnedSourceRoot, "pinned Prime Agent source");
  assertExpectedSourceIdentity(source);
  if (runGit(["status", "--porcelain", "--untracked-files=all"], source)) {
    throw new Error("pinned Prime Agent source checkout changed during the security build");
  }
  const systemTempRoot = process.platform === "win32" ? await realpath(tmpdir()) : undefined;
  const expectedBuildRoot = resolvePrimeAgentSecurityBuildRoot(root, buildRoot, { systemTempRoot });
  if (!samePath(resolve(buildRoot), expectedBuildRoot)) {
    throw new Error("Prime Agent security build path does not match the pinned output location");
  }
  const inputs = await loadReviewedInputs(root);
  const baseMarker = expectedMarker(inputs);
  const verified = await readExistingMarker(expectedBuildRoot, baseMarker, inputs.lockBytes);
  return {
    path: expectedBuildRoot,
    sourceFileHashes: verified.sourceFileHashes,
    provenance: verified.marker,
  };
}

export async function preparePrimeAgentSecurityBuildTree(projectRoot, pinnedSourceRoot, requestedBuildRoot, systemTempRoot) {
  const root = await assertSecureProjectRoot(projectRoot);
  const source = await assertSecureSourceRoot(pinnedSourceRoot, "pinned Prime Agent source");
  const expectedSource = assertExpectedSourceIdentity(source);
  if (runGit(["status", "--porcelain", "--untracked-files=all"], source)) {
    throw new Error("pinned Prime Agent source checkout is modified; refusing to prepare the security build");
  }
  if (expectedSource.head !== PRIME_AGENT_PIN.commit
    || expectedSource.origin !== PRIME_AGENT_PIN.repository
    || PRIME_AGENT_PIN.commit !== EXPECTED.sourceCommit
    || PRIME_AGENT_PIN.version !== EXPECTED.sourceVersion
    || PRIME_AGENT_PIN.license !== EXPECTED.sourceLicense) {
    throw new Error("Prime Agent source pin differs from the reviewed security overlay base");
  }
  const inputs = await loadReviewedInputs(root);
  const baseMarker = expectedMarker(inputs);
  const buildRoot = resolvePrimeAgentSecurityBuildRoot(root, requestedBuildRoot, { systemTempRoot });
  await removeExistingBuild(buildRoot, baseMarker, inputs.lockBytes);

  const overlay = await withGitAutocrlfDisabled(() => prepareDependencyOverlay(source, buildRoot, root));
  try {
    if (resolve(overlay.path) !== buildRoot
      || overlay.commit !== EXPECTED.sourceCommit
      || overlay.version !== EXPECTED.sourceVersion
      || overlay.license !== EXPECTED.sourceLicense
      || overlay.packageLockSha256 !== EXPECTED.overlayLockSha256) {
      throw new Error("dependency overlay preparation returned mismatched Prime Agent provenance");
    }
    await assertSecureSourceRoot(buildRoot, "Prime Agent security build output");
    assertExpectedSourceIdentity(buildRoot);
    const patches = [
      { name: "session-lease", bytes: inputs.leasePatchBytes, sha256: EXPECTED.leasePatchSha256, unidiffZero: false },
      { name: "windows-zip-guard", bytes: inputs.zipGuardPatchBytes, sha256: EXPECTED.zipGuardPatchSha256, unidiffZero: true },
      { name: "worker-shutdown-fence", bytes: inputs.workerShutdownFencePatchBytes, sha256: EXPECTED.workerShutdownFencePatchSha256, unidiffZero: false },
    ];
    applyReviewedSourcePatches(buildRoot, patches);
    const output = await assertBuildOutputFiles(buildRoot, null, inputs.lockBytes);
    const marker = withBuildMarker(baseMarker, output.sourceFileHashes);
    const markerPath = resolve(buildRoot, BUILD_MARKER);
    await writeFile(markerPath, `${JSON.stringify(marker, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    await assertRegularFileNoSymlink(buildRoot, [BUILD_MARKER], "security build ownership marker");
    const untracked = runGit(["ls-files", "--others", "--exclude-standard"], buildRoot).split(/\r?\n/).filter(Boolean).sort();
    if (!isDeepStrictEqual(untracked, [BUILD_MARKER])) {
      throw new Error("Prime Agent security build contains unexpected untracked files after preparation");
    }
    return {
      path: buildRoot,
      commit: overlay.commit,
      version: overlay.version,
      license: overlay.license,
      packageLockSha256: overlay.packageLockSha256,
      registryMetadataValidatedAt: overlay.registryMetadataValidatedAt,
      overrides: overlay.overrides,
      provenance: {
        ...marker,
        sourceDirectory: source,
        buildDirectory: buildRoot,
        sourceFiles: output.sourceFileHashes,
        patchedTrackedFiles: output.changedFiles,
        immutableSourcePreserved: true,
      },
    };
  } catch (error) {
    try {
      await assertSecureSourceRoot(buildRoot, "failed Prime Agent security build output");
      assertExpectedSourceIdentity(buildRoot);
      const current = await realpath(buildRoot);
      if (samePath(current, buildRoot)) await rm(buildRoot, { recursive: true, force: true });
    } catch (cleanupError) {
      throw new Error(`${error.message}; secure cleanup failed: ${cleanupError.message}`);
    }
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const projectRoot = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_PROJECT_ROOT;
  const prepare = async () => {
    const systemTempRoot = process.platform === "win32" ? await realpath(tmpdir()) : tmpdir();
    const privateTempRoot = process.platform === "win32"
      ? await mkdtemp(join(systemTempRoot, "sophos-prime-agent-security-"))
      : undefined;
    const paths = resolvePrimeAgentSecurityWorkPaths(projectRoot, {
      platform: process.platform,
      systemTempRoot,
      privateTempRoot,
    });
    const sourceRoot = process.argv[3] ? resolve(process.argv[3]) : paths.sourceRoot;
    return preparePrimeAgentSecurityBuildTree(projectRoot, sourceRoot, paths.buildRoot, systemTempRoot);
  };
  prepare()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(`Prime Agent security build preparation failed: ${error.message}`);
      process.exitCode = 1;
    });
}
