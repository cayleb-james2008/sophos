import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const helpersUrl = new URL("./helpers.mjs", import.meta.url).href;
const probe = `import { SCREENSHOT_DIR } from ${JSON.stringify(helpersUrl)}; process.stdout.write(SCREENSHOT_DIR);`;

function screenshotDirFor(env) {
  return execFileSync(process.execPath, ["--input-type=module", "--eval", probe], {
    encoding: "utf8",
    env,
  }).trim();
}

test("uses CUA_SCREENSHOT_DIR for isolated per-run screenshot output", () => {
  const expected = path.resolve(os.tmpdir(), `cua-screenshots-${process.pid}`);
  const actual = screenshotDirFor({ ...process.env, CUA_SCREENSHOT_DIR: expected });
  assert.equal(actual, expected);
});

test("defaults screenshot output beside the helpers when no override is set", () => {
  const env = { ...process.env };
  delete env.CUA_SCREENSHOT_DIR;
  const expected = path.join(path.dirname(fileURLToPath(import.meta.url)), "screenshots");
  assert.equal(screenshotDirFor(env), expected);
});
