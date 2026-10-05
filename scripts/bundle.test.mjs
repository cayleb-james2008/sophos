import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const bundleSource = await readFile(new URL("./bundle.mjs", import.meta.url), "utf8");

test("bridge compiles against packages built from the pinned overlay, not the clean source clone", () => {
  const bridgeInstall = bundleSource.indexOf('runNpm(["ci"], { cwd: BRIDGE_DIR, label: "bridge locked dependency install (normal lifecycle)" });');
  const bridgeBuild = bundleSource.indexOf('runNpm(["run", "build"], { cwd: BRIDGE_DIR, label: "bridge TypeScript build" });');
  const builtPackageStage = bundleSource.indexOf('stageUpstreamPackages(primeBuild.path, join(BRIDGE_DIR, "node_modules"))');

  assert.ok(bridgeInstall >= 0, "bundle installs the bridge's locked dependencies");
  assert.ok(bridgeBuild > bridgeInstall, "bundle compiles the bridge after installing its dependencies");
  assert.ok(
    builtPackageStage > bridgeInstall && builtPackageStage < bridgeBuild,
    "bundle replaces the bridge's clean-source file links with packages built from the exact pinned overlay before TypeScript resolves their dist exports",
  );
});
