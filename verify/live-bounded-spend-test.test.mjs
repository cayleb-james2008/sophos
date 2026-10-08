import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(new URL("./live-bounded-spend-test.mjs", import.meta.url));

test("retired spend experiment preserves original bytes as non-executable text", async () => {
  const archive = await readFile(new URL("./archive/live-bounded-spend-test.mjs.txt", import.meta.url));
  assert.equal(createHash("sha256").update(archive).digest("hex"),
    "36631954882400654c1ead2ed8203ecd276b1be8ba632b8ec573e7101c694b9d");
});

test("legacy command fails closed without touching settings or executing paid inference", async () => {
  const source = await readFile(script, "utf8");
  assert.doesNotMatch(source, /\b(import|spawn|fetch)\s*\(/);
  assert.doesNotMatch(source, /^import\s/m, "retirement stub has no executable dependencies");
  const home = await mkdtemp(join(tmpdir(), "sophos-retired-spend-"));
  try {
    const settings = join(home, ".prime", "agent", "settings.json");
    await mkdir(dirname(settings), { recursive: true });
    const original = '{"sentinel":"must-not-change"}\n';
    await writeFile(settings, original);
    const result = spawnSync(process.execPath, [script], {
      cwd: home, encoding: "utf8", timeout: 5_000,
      env: { HOME: home, USERPROFILE: home, PATH: "", PI_OFFLINE: "1" },
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /Retired:.*not a live budget check/);
    assert.equal(result.stdout, "");
    assert.equal(await readFile(settings, "utf8"), original);
  } finally { await rm(home, { recursive: true, force: true }); }
});
