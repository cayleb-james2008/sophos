import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PRIME_AGENT_PIN } from "./runtime-pins.mjs";
import { validatePrimeAgentRef } from "./prime-agent-ref.mjs";

const OVERLAY_MARKER = ".sophos-prime-agent-overlay.json";

export const PRIME_AGENT_SESSION_LEASE_OVERLAY = Object.freeze({
  id: "prime-agent-v070-windows-session-lease-v1",
  upstreamRepository: "https://github.com/PrimeIntellect-ai/prime-agent.git",
  upstreamCommit: "be9e2fa0714e7cd1c6bd9bdb1b554d2cc6550387",
  sourcePath: "packages/coding-agent/src/core/session-lease.ts",
  sourceSha256: "78ae066a92f101771875a9d566549761ab459aaa4c7f6ce1de087cc00a6e462a",
  patchPath: "patches/prime-agent-v0.7.0-session-lease-windows.patch",
  patchSha256: "ad532cd1e52dd1e6e05bb3e8fd788cf73aee6ecb6be955c38dc43c042f3d8a27",
  patchedSourceSha256: "006802f39f6de128e6b7f418e9fb3b2793ef73410d1247db562ce5dcbe7a0349",
});

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function runGit(args, cwd) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  if (result.error) throw new Error(`git ${args.join(" ")} could not start: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = `${result.stderr ?? ""}${result.stdout ?? ""}`.trim();
    throw new Error(`git ${args.join(" ")} failed (${result.status})${detail ? `: ${detail}` : ""}`);
  }
  return (result.stdout ?? "").trim();
}

function resolvePatchPath(projectRoot, patchPath) {
  const root = resolve(projectRoot);
  const absolutePath = isAbsolute(patchPath) ? resolve(patchPath) : resolve(root, patchPath);
  const relativePath = relative(root, absolutePath);
  if (!relativePath || relativePath === ".." || relativePath.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(relativePath)) {
    throw new Error("Prime Agent overlay patch must be inside the Sophos project tree");
  }
  return absolutePath;
}

function expectedProvenance(overlay) {
  return {
    id: overlay.id,
    upstreamRepository: overlay.upstreamRepository,
    upstreamCommit: overlay.upstreamCommit,
    sourcePath: overlay.sourcePath,
    sourceSha256: overlay.sourceSha256,
    patchPath: overlay.patchPath,
    patchSha256: overlay.patchSha256,
    patchedSourceSha256: overlay.patchedSourceSha256,
  };
}

function verifyExistingOverlay(overlayRoot, expected) {
  const markerPath = join(overlayRoot, OVERLAY_MARKER);
  let marker;
  try {
    marker = JSON.parse(readFileSync(markerPath, "utf8"));
  } catch (error) {
    throw new Error(`Refusing to replace an unowned Prime Agent overlay at ${overlayRoot}: ${error.message}`);
  }
  if (JSON.stringify(marker) !== JSON.stringify(expected)) {
    throw new Error(`Refusing to replace a Prime Agent overlay with different provenance at ${overlayRoot}`);
  }
  if (runGit(["rev-parse", "HEAD"], overlayRoot) !== expected.upstreamCommit) {
    throw new Error(`Existing Prime Agent overlay has a different base commit at ${overlayRoot}`);
  }
  if (runGit(["remote", "get-url", "origin"], overlayRoot) !== expected.upstreamRepository) {
    throw new Error(`Existing Prime Agent overlay has a different origin at ${overlayRoot}`);
  }
  const changedFiles = runGit(["diff", "--name-only"], overlayRoot).split(/\r?\n/).filter(Boolean);
  if (changedFiles.length !== 1 || changedFiles[0] !== expected.sourcePath) {
    throw new Error(`Existing Prime Agent overlay contains unexpected tracked changes at ${overlayRoot}`);
  }
  if (runGit(["diff", "--cached", "--name-only"], overlayRoot)) {
    throw new Error(`Existing Prime Agent overlay contains staged changes at ${overlayRoot}`);
  }
  const untrackedFiles = runGit(["ls-files", "--others", "--exclude-standard"], overlayRoot)
    .split(/\r?\n/).filter(Boolean).filter((name) => name !== OVERLAY_MARKER);
  if (untrackedFiles.length) {
    throw new Error(`Existing Prime Agent overlay contains unexpected untracked files at ${overlayRoot}: ${untrackedFiles.join(", ")}`);
  }
  const patchedPath = join(overlayRoot, expected.sourcePath);
  if (sha256(readFileSync(patchedPath)) !== expected.patchedSourceSha256) {
    throw new Error(`Existing Prime Agent overlay source hash drifted at ${patchedPath}`);
  }
  rmSync(overlayRoot, { recursive: true, force: true });
}

export function preparePrimeAgentBuildTree(
  projectRoot,
  pinnedSourceRoot,
  { pin = PRIME_AGENT_PIN, overlay = PRIME_AGENT_SESSION_LEASE_OVERLAY } = {},
) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(overlay.id)) throw new Error("Prime Agent overlay ID is invalid");
  if (overlay.upstreamRepository !== pin.repository || overlay.upstreamCommit !== pin.commit) {
    throw new Error("Prime Agent overlay base does not match the pinned public source identity");
  }
  const root = resolve(projectRoot);
  const source = resolve(pinnedSourceRoot);
  const sourceIdentity = validatePrimeAgentRef(source, pin);
  const sourcePath = join(source, overlay.sourcePath);
  const sourceHash = sha256(readFileSync(sourcePath));
  if (sourceHash !== overlay.sourceSha256) {
    throw new Error(`Prime Agent overlay source hash does not match the pinned base (expected ${overlay.sourceSha256}, found ${sourceHash})`);
  }
  const patchPath = resolvePatchPath(root, overlay.patchPath);
  const patchHash = sha256(readFileSync(patchPath));
  if (patchHash !== overlay.patchSha256) {
    throw new Error(`Prime Agent overlay patch SHA-256 does not match the pinned digest (expected ${overlay.patchSha256}, found ${patchHash})`);
  }
  const expected = expectedProvenance(overlay);
  const overlayRoot = join(root, ".deps", `${overlay.id}-build`);
  if (existsSync(overlayRoot)) verifyExistingOverlay(overlayRoot, expected);

  mkdirSync(dirname(overlayRoot), { recursive: true });
  let created = true;
  try {
    runGit(["clone", "--quiet", "--shared", "--no-checkout", "--no-tags", source, overlayRoot], root);
    runGit(["checkout", "--quiet", "--detach", overlay.upstreamCommit], overlayRoot);
    runGit(["remote", "set-url", "origin", overlay.upstreamRepository], overlayRoot);
    if (runGit(["rev-parse", "HEAD"], overlayRoot) !== overlay.upstreamCommit) {
      throw new Error("Cloned Prime Agent build tree does not match the asserted upstream commit");
    }
    if (runGit(["remote", "get-url", "origin"], overlayRoot) !== overlay.upstreamRepository) {
      throw new Error("Cloned Prime Agent build tree does not retain the public upstream origin");
    }
    if (runGit(["status", "--porcelain", "--untracked-files=all"], overlayRoot)) {
      throw new Error("Fresh Prime Agent build tree is not pristine before applying the overlay");
    }
    const buildSourcePath = join(overlayRoot, overlay.sourcePath);
    const buildSourceHash = sha256(readFileSync(buildSourcePath));
    if (buildSourceHash !== overlay.sourceSha256) {
      throw new Error(`Cloned Prime Agent source hash does not match the pinned base (expected ${overlay.sourceSha256}, found ${buildSourceHash})`);
    }
    runGit(["apply", "--check", patchPath], overlayRoot);
    runGit(["apply", patchPath], overlayRoot);
    runGit(["diff", "--check"], overlayRoot);
    const changedFiles = runGit(["diff", "--name-only"], overlayRoot).split(/\r?\n/).filter(Boolean);
    if (changedFiles.length !== 1 || changedFiles[0] !== overlay.sourcePath) {
      throw new Error(`Prime Agent overlay changed unexpected source files: ${changedFiles.join(", ")}`);
    }
    const patchedSourceHash = sha256(readFileSync(buildSourcePath));
    if (patchedSourceHash !== overlay.patchedSourceSha256) {
      throw new Error(`Prime Agent overlay output hash mismatch (expected ${overlay.patchedSourceSha256}, found ${patchedSourceHash})`);
    }
    writeFileSync(join(overlayRoot, OVERLAY_MARKER), `${JSON.stringify(expected, null, 2)}\n`);
    created = false;
    return {
      path: overlayRoot,
      provenance: {
        ...expected,
        sourceDirectory: sourceIdentity.path,
        buildDirectory: overlayRoot,
      },
    };
  } catch (error) {
    if (created) rmSync(overlayRoot, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const sourceRoot = resolve(projectRoot, ".deps", "prime-agent");
  try {
    console.log(JSON.stringify(preparePrimeAgentBuildTree(projectRoot, sourceRoot), null, 2));
  } catch (error) {
    console.error(`Prime Agent overlay failed: ${error.message}`);
    process.exitCode = 1;
  }
}
