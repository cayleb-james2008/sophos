import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PRIME_AGENT_PIN } from "./runtime-pins.mjs";

function runGit(args, { cwd, quiet = true } = {}) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit",
    windowsHide: true,
  });
  if (result.error) throw new Error(`git ${args.join(" ")} could not start: ${result.error.message}`);
  if (result.status !== 0) {
    const details = `${result.stderr ?? ""}${result.stdout ?? ""}`.trim();
    throw new Error(`git ${args.join(" ")} failed (${result.status})${details ? `: ${details}` : ""}`);
  }
  return (result.stdout ?? "").trim();
}

export function resolvePrimeAgentRef(projectRoot, override = process.env.PRIME_AGENT_REF) {
  if (!override) return resolve(projectRoot, ".deps", "prime-agent");
  return isAbsolute(override) ? resolve(override) : resolve(projectRoot, override);
}

export function validatePrimeAgentRef(refPath, pin = PRIME_AGENT_PIN) {
  const root = resolve(refPath);
  if (!existsSync(root)) throw new Error(`Prime Agent checkout does not exist: ${root}`);
  const actualCommit = runGit(["rev-parse", "HEAD"], { cwd: root });
  if (actualCommit !== pin.commit) {
    throw new Error(`Prime Agent commit ${actualCommit} does not match pinned commit ${pin.commit}`);
  }
  const origin = runGit(["remote", "get-url", "origin"], { cwd: root });
  if (origin !== pin.repository) {
    throw new Error(`Prime Agent origin ${origin} does not match pinned repository ${pin.repository}`);
  }
  const dirty = runGit(["status", "--porcelain"], { cwd: root });
  if (dirty) throw new Error(`Prime Agent checkout is modified; refusing to build from a dirty source tree:\n${dirty}`);

  const codingPackagePath = resolve(root, "packages", "coding-agent", "package.json");
  const codingPackage = JSON.parse(readFileSync(codingPackagePath, "utf8"));
  if (codingPackage.version !== pin.version || codingPackage.license !== pin.license) {
    throw new Error(`Prime Agent coding-agent package identity mismatch: expected ${pin.version} ${pin.license}, found ${codingPackage.version} ${codingPackage.license}`);
  }
  const licenseText = readFileSync(resolve(root, "LICENSE"), "utf8");
  if (!licenseText.startsWith("MIT License")) throw new Error("Pinned Prime Agent LICENSE is missing or is not the expected MIT license");
  return { path: root, repository: origin, ref: pin.ref, commit: actualCommit, version: codingPackage.version, license: codingPackage.license };
}

export async function ensurePrimeAgentRef(projectRoot, override = process.env.PRIME_AGENT_REF, pin = PRIME_AGENT_PIN) {
  const root = resolvePrimeAgentRef(projectRoot, override);
  if (existsSync(root)) return validatePrimeAgentRef(root, pin);

  await mkdir(dirname(root), { recursive: true });
  try {
    runGit([
      "clone", "--depth", "1", "--branch", pin.ref, "--single-branch", "--no-recurse-submodules", "--no-checkout",
      pin.repository, root,
    ], { cwd: projectRoot, quiet: false });
    runGit(["config", "core.autocrlf", "false"], { cwd: root });
    runGit(["checkout", "--quiet", "--detach", pin.commit], { cwd: root });
    return validatePrimeAgentRef(root, pin);
  } catch (error) {
    await rm(root, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  ensurePrimeAgentRef(projectRoot)
    .then((source) => console.log(JSON.stringify(source, null, 2)))
    .catch((error) => {
      console.error(`Prime Agent setup failed: ${error.message}`);
      process.exitCode = 1;
    });
}
