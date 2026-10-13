import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundleScript = resolve(root, "scripts", "bundle.mjs");

test("default runtime bundling refuses the real non-Windows host before staging", {
  skip: process.platform === "win32",
}, async () => {
  const emptyHome = await mkdtemp(join(tmpdir(), "sophos-native-platform-"));
  try {
    const result = spawnSync(process.execPath, [bundleScript, "--layout-check-only"], {
      cwd: root,
      encoding: "utf8",
      env: {
        HOME: emptyHome,
        PATH: dirname(process.execPath),
        TMPDIR: tmpdir(),
        LANG: "C.UTF-8",
      },
      timeout: 10_000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      new RegExp(`Windows release must run on a real Windows x64 host; got ${process.platform}/${process.arch}`),
    );
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /npm ci|network|download/i);
  } finally {
    await rm(emptyHome, { recursive: true, force: true });
  }
});
