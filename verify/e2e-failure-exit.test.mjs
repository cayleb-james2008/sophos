import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NODE_RUNTIME_PIN, PRIME_AGENT_PIN } from "../scripts/runtime-pins.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCES = [
  "verify/e2e.mjs", "verify/runtime-executable.mjs", "verify/e2e-result.mjs",
  "verify/e2e-home-cleanup.mjs",
  "scripts/node-runtime.mjs", "scripts/runtime-pins.mjs", "scripts/runtime-pins.json",
  "scripts/prime-agent-ref.mjs", "scripts/apply-prime-agent-overlay.mjs",
  "scripts/prepare-prime-agent-security-build.mjs", "scripts/prepare-dependency-overlay.mjs",
  "scripts/dependency-hardening/windows-acl-security.mjs",
];

// These intentionally incomplete assets exercise the verifier's refusal paths,
// not daemon functionality, native runtime validity, or successful packaging.
function withFixture(fn) {
  const root = mkdtempSync(join(tmpdir(), "sophos-gate-fixture-"));
  try {
    for (const source of SOURCES) {
      const target = join(root, source);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(join(ROOT, source), target);
    }
    const home = join(root, "private-home");
    const temp = join(root, "private-temp");
    mkdirSync(home);
    mkdirSync(temp);
    const invoke = () => {
      const child = spawnSync(process.execPath, [join(root, "verify/e2e.mjs")], {
        cwd: root, timeout: 15_000, encoding: "utf8",
        env: { PATH: process.env.PATH ?? "", HOME: home, USERPROFILE: home,
          TMPDIR: temp, TEMP: temp, TMP: temp, PI_OFFLINE: "1" },
      });
      assert.equal(child.error, undefined, child.error?.message);
      assert.equal(child.signal, null, "gate subprocess must complete, not time out");
      const report = JSON.parse(readFileSync(join(root, "verify/e2e-report.json"), "utf8"));
      return { child, report };
    };
    fn({ root, invoke });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeAsset(root, relative, contents = "") {
  const target = join(root, relative);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
}

function fillLayout(root, manifest) {
  writeAsset(root, `resources/node/node-v${NODE_RUNTIME_PIN.version}-${NODE_RUNTIME_PIN.platform}/node.exe`);
  writeAsset(root, "resources/daemon/dist/cli.js");
  writeAsset(root, "resources/bridge/dist/bridge/src/index.js");
  writeAsset(root, "resources/daemon/LICENSE", "MIT License\n");
  mkdirSync(join(root, "resources/node_modules"), { recursive: true });
  writeAsset(root, "resources/.bundle-manifest.json", manifest);
  const marker = join(root, "verifier-invoked");
  writeAsset(root, "bridge/verify.mjs", `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'unexpected'); process.exitCode=1;`);
  return marker;
}

test("missing staged runtime reports FAIL and exits nonzero", () => withFixture(({ invoke }) => {
  const { child, report } = invoke();
  assert.equal(report.summary.overall, "FAIL");
  assert.equal(report.summary.reason, "staged runtime layout incomplete");
  assert.equal(child.status, 1, child.stdout + child.stderr);
}));

test("invalid bundle manifest reports FAIL and exits nonzero", () => withFixture(({ root, invoke }) => {
  const marker = fillLayout(root, "{ invalid json");
  const { child, report } = invoke();
  assert.equal(report.summary.overall, "FAIL");
  assert.equal(report.summary.reason, "bundle manifest missing or invalid");
  assert.equal(child.status, 1, child.stdout + child.stderr);
  assert.equal(existsSync(marker), false, "invalid manifest must never launch the verifier");
}));

test("failed provenance refuses runtime execution before verifier launch", () => withFixture(({ root, invoke }) => {
  const marker = fillLayout(root, JSON.stringify({ upstream: { ...PRIME_AGENT_PIN, commit: "wrong-commit" } }));
  const { child, report } = invoke();
  assert.equal(report.summary.overall, "FAIL");
  assert.equal(child.status, 1, child.stdout + child.stderr);
  assert.equal(existsSync(marker), false, "failed provenance must never launch the verifier");
}));
