import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { ensurePrimeAgentRef, resolvePrimeAgentRef, validatePrimeAgentRef } from "./prime-agent-ref.mjs";
import { PRIME_AGENT_PIN } from "./runtime-pins.mjs";

function runGit(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

test("the default Prime Agent checkout is inside the Sophos repository", () => {
  assert.equal(resolvePrimeAgentRef("/work/sophos"), resolve("/work/sophos", ".deps", "prime-agent"));
});

test("an explicit Prime Agent checkout override is preserved", () => {
  assert.equal(resolvePrimeAgentRef("/work/sophos", "/opt/prime-agent"), resolve("/opt/prime-agent"));
});

test("the pinned source identity is immutable and license-auditable", () => {
  assert.equal(PRIME_AGENT_PIN.repository, "https://github.com/PrimeIntellect-ai/prime-agent.git");
  assert.equal(PRIME_AGENT_PIN.ref, "v0.7.0");
  assert.equal(PRIME_AGENT_PIN.commit, "be9e2fa0714e7cd1c6bd9bdb1b554d2cc6550387");
  assert.equal(PRIME_AGENT_PIN.version, "0.7.0");
  assert.equal(PRIME_AGENT_PIN.license, "MIT");
});

test("a same-origin checkout at a different commit is rejected", () => {
  const root = mkdtempSync(join(tmpdir(), "sophos-prime-ref-test-"));
  try {
    mkdirSync(join(root, "packages", "coding-agent"), { recursive: true });
    writeFileSync(join(root, "packages", "coding-agent", "package.json"), JSON.stringify({ version: "0.7.0", license: "MIT" }));
    writeFileSync(join(root, "LICENSE"), "MIT License\n");
    runGit(["init", "--quiet"], root);
    runGit(["remote", "add", "origin", PRIME_AGENT_PIN.repository], root);
    runGit(["add", "LICENSE", "packages/coding-agent/package.json"], root);
    const commit = spawnSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--quiet", "-m", "fixture"], { cwd: root, encoding: "utf8" });
    assert.equal(commit.status, 0, commit.stderr || commit.stdout);
    assert.throws(() => validatePrimeAgentRef(root), /does not match pinned commit/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a fresh pinned checkout preserves source bytes when Git autocrlf is enabled", async () => {
  const root = mkdtempSync(join(tmpdir(), "sophos-prime-autocrlf-test-"));
  const source = join(root, "upstream");
  const checkout = join(root, "checkout");
  const sourceFile = "packages/coding-agent/src/core/session-lease.ts";
  const sourceText = "export const leaseOwner = \"fixture\";\n";
  try {
    mkdirSync(join(source, "packages", "coding-agent", "src", "core"), { recursive: true });
    writeFileSync(join(source, "packages", "coding-agent", "package.json"), JSON.stringify({ version: "0.7.0", license: "MIT" }));
    writeFileSync(join(source, "packages", "coding-agent", "src", "core", "session-lease.ts"), sourceText);
    writeFileSync(join(source, "LICENSE"), "MIT License\nfixture\n");
    runGit(["init", "--quiet"], source);
    runGit(["config", "user.name", "Prime Agent Test"], source);
    runGit(["config", "user.email", "prime-agent-test@example.invalid"], source);
    runGit(["add", "--all"], source);
    runGit(["commit", "--quiet", "-m", "fixture source"], source);
    runGit(["tag", "fixture-v0.7.0"], source);
    const commit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: source, encoding: "utf8" }).stdout.trim();
    const pin = { repository: source, ref: "fixture-v0.7.0", commit, version: "0.7.0", license: "MIT" };
    const globalConfig = join(root, "global.gitconfig");
    writeFileSync(globalConfig, "[core]\nautocrlf = true\n");
    const previousGlobalConfig = process.env.GIT_CONFIG_GLOBAL;
    process.env.GIT_CONFIG_GLOBAL = globalConfig;
    try {
      const autocrlf = spawnSync("git", ["config", "--global", "--get", "core.autocrlf"], { cwd: source, encoding: "utf8" });
      assert.equal(autocrlf.status, 0, autocrlf.stderr || autocrlf.stdout);
      assert.equal(autocrlf.stdout.trim(), "true");
      const result = await ensurePrimeAgentRef(root, checkout, pin);
      assert.equal(result.commit, commit);
      assert.equal(readFileSync(join(checkout, sourceFile), "utf8"), sourceText);
      const checkoutStatus = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: checkout, encoding: "utf8" });
      assert.equal(checkoutStatus.status, 0, checkoutStatus.stderr || checkoutStatus.stdout);
      assert.equal(checkoutStatus.stdout.trim(), "");
    } finally {
      if (previousGlobalConfig === undefined) delete process.env.GIT_CONFIG_GLOBAL;
      else process.env.GIT_CONFIG_GLOBAL = previousGlobalConfig;
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
