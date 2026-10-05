import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { resolveDriverBin } from "./driver.mjs";

test("Windows CUA driver path follows the runner's installed LOCALAPPDATA", () => {
  const localAppData = String.raw`C:\Users\runneradmin\AppData\Local`;
  assert.equal(
    resolveDriverBin({ platform: "win32", env: { LOCALAPPDATA: localAppData } }),
    path.win32.join(
      localAppData,
      "Programs",
      "Cua",
      "cua-driver",
      "bin",
      "cua-driver.exe",
    ),
  );
});
