import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { resolvePrimeAgentRef, validatePrimeAgentRef } from "./prime-agent-ref.mjs";
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
