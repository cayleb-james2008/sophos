import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const config = JSON.parse(readFileSync(resolve(root, "src-tauri/tauri.conf.json"), "utf8"));

test("Tauri resource planner maps the staged upstream license into app resources", () => {
  assert.equal(config.bundle.resources["../resources/daemon/LICENSE"], "daemon/LICENSE");
});
