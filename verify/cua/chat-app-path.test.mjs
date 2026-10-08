import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const chatSource = readFileSync(path.join(dir, "chat.test.mjs"), "utf8");
const appPaths = await import("./chat-app-path.mjs").catch(() => null);
const winRoot = String.raw`D:\a\sophos\sophos`;

test("chat suite selects the real release exe from this checkout when debug is absent", () => {
  assert.equal(typeof appPaths?.resolveChatAppPath, "function");
  const result = appPaths.resolveChatAppPath({
    workspaceRoot: winRoot,
    exists: () => false,
    pathImpl: path.win32,
  });
  assert.equal(
    result,
    path.win32.join(winRoot, "src-tauri", "target", "release", "prime-agent-windows.exe"),
  );
});

test("chat suite prefers a local debug exe only when it exists", () => {
  assert.equal(typeof appPaths?.resolveChatAppPath, "function");
  const result = appPaths.resolveChatAppPath({
    workspaceRoot: winRoot,
    exists: (candidate) => candidate.includes("\\debug\\"),
    pathImpl: path.win32,
  });
  assert.equal(
    result,
    path.win32.join(winRoot, "src-tauri", "target", "debug", "prime-agent-windows.exe"),
  );
});

test("chat UI suite does not pin its executable under a developer profile", () => {
  assert.equal(chatSource.includes("C:/Users/Cayleb/Desktop/workspace/sophos"), false);
  assert.match(chatSource, /resolveChatAppPath/);
});
