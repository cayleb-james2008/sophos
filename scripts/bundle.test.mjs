import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import test from "node:test";
import { delimiter, dirname, join } from "node:path";

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

test("production install reproduces a missing dev-only root-prepare command and safely replays prod scripts", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "sophos-production-lifecycle-"));
  const fixtureRoot = join(temporaryRoot, "fixture");
  const home = join(temporaryRoot, "home");
  const npmCache = join(temporaryRoot, "npm-cache");
  const npmTemp = join(temporaryRoot, "tmp");
  const appData = join(home, "AppData", "Roaming");
  const localAppData = join(home, "AppData", "Local");
  const marker = join(temporaryRoot, "production-postinstall-ran");
  const prodPackage = join(fixtureRoot, "prod-fixture");
  const huskyPackage = join(fixtureRoot, "husky-fixture");

  try {
    await Promise.all([
      mkdir(fixtureRoot, { recursive: true }),
      mkdir(prodPackage, { recursive: true }),
      mkdir(join(huskyPackage, "bin"), { recursive: true }),
      mkdir(npmCache, { recursive: true }),
      mkdir(npmTemp, { recursive: true }),
      mkdir(appData, { recursive: true }),
      mkdir(localAppData, { recursive: true }),
    ]);
    await writeFile(join(fixtureRoot, "package.json"), `${JSON.stringify({
      name: "sophos-production-lifecycle-fixture",
      version: "1.0.0",
      private: true,
      scripts: { prepare: "husky" },
      dependencies: { "prod-fixture": "file:./prod-fixture" },
      devDependencies: { husky: "file:./husky-fixture" },
    }, null, 2)}\n`);
    await writeFile(join(prodPackage, "package.json"), `${JSON.stringify({
      name: "prod-fixture",
      version: "1.0.0",
      scripts: { postinstall: "node postinstall.cjs" },
    }, null, 2)}\n`);
    await writeFile(join(prodPackage, "postinstall.cjs"), "require('node:fs').writeFileSync(process.env.PROD_MARKER, 'ran');\n");
    await writeFile(join(huskyPackage, "package.json"), `${JSON.stringify({
      name: "husky",
      version: "1.0.0",
      bin: { husky: "bin/husky.cjs" },
    }, null, 2)}\n`);
    await writeFile(join(huskyPackage, "bin", "husky.cjs"), "process.exit(0);\n");

    const npmPath = [dirname(process.execPath)];
    const windowsSystemRoot = process.env.SystemRoot ?? process.env.WINDIR;
    if (process.platform === "win32" && windowsSystemRoot) npmPath.push(join(windowsSystemRoot, "System32"));
    else if (process.platform !== "win32") npmPath.push("/usr/bin", "/bin");
    const env = {
      PATH: npmPath.join(delimiter),
      HOME: home,
      USERPROFILE: home,
      TMPDIR: npmTemp,
      TEMP: npmTemp,
      TMP: npmTemp,
      APPDATA: appData,
      LOCALAPPDATA: localAppData,
      SystemRoot: process.env.SystemRoot ?? "",
      WINDIR: process.env.WINDIR ?? process.env.SystemRoot ?? "",
      ComSpec: process.env.ComSpec ?? "",
      PATHEXT: process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD",
      CI: "1",
      NO_COLOR: "1",
      NPM_CONFIG_USERCONFIG: join(temporaryRoot, "npmrc-user-empty"),
      NPM_CONFIG_GLOBALCONFIG: join(temporaryRoot, "npmrc-global-empty"),
      NPM_CONFIG_CACHE: npmCache,
      NPM_CONFIG_REGISTRY: "https://registry.npmjs.org/",
      NPM_CONFIG_AUDIT: "false",
      NPM_CONFIG_FUND: "false",
      NPM_CONFIG_OFFLINE: "true",
      PROD_MARKER: marker,
    };
    await writeFile(env.NPM_CONFIG_USERCONFIG, "");
    await writeFile(env.NPM_CONFIG_GLOBALCONFIG, "");

    const runNpm = (args) => {
      const result = spawnSync("npm", args, {
        cwd: fixtureRoot,
        env,
        encoding: "utf8",
        shell: process.platform === "win32",
        windowsHide: true,
      });
      assert.equal(result.error, undefined, result.error?.message);
      return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
    };

    const lockSetup = runNpm(["install", "--package-lock-only", "--ignore-scripts", "--offline", "--no-audit", "--no-fund"]);
    assert.equal(lockSetup.status, 0, lockSetup.output);
    const lockPath = join(fixtureRoot, "package-lock.json");
    const lockBytes = await readFile(lockPath);

    const baseline = runNpm(["ci", "--omit=dev", "--offline", "--no-audit", "--no-fund"]);
    assert.notEqual(baseline.status, 0, "the unguarded production install should expose the missing dev-only husky command");
    assert.match(
      baseline.output.replace(/\s+/g, " "),
      /husky.{0,80}(?:not recognized as an internal or external command|not found|command not found)/i,
      "the root prepare must fail specifically because the dev-only husky command is unavailable",
    );
    assert.deepEqual(await readFile(lockPath), lockBytes, "the reproduced lifecycle failure must not alter the reviewed lock bytes");
    await rm(marker, { force: true });

    const candidateCi = runNpm(["ci", "--omit=dev", "--ignore-scripts", "--offline", "--no-audit", "--no-fund"]);
    assert.equal(candidateCi.status, 0, candidateCi.output);
    assert.equal(existsSync(marker), false, "the script-suppressed production install must not satisfy the later lifecycle assertion");
    await rm(marker, { force: true });
    const candidateRebuild = runNpm(["rebuild", "--omit=dev", "--offline", "--no-audit", "--no-fund"]);
    assert.equal(candidateRebuild.status, 0, candidateRebuild.output);
    assert.equal(await readFile(marker, "utf8"), "ran", "production dependency postinstall must run after script-suppressed tree construction");
    assert.equal(existsSync(join(fixtureRoot, "node_modules", "husky")), false,
      "the production dependency tree must keep dev-only husky omitted");
    assert.deepEqual(await readFile(lockPath), lockBytes, "production script replay must preserve exact lock bytes");

    const productionCi = bundleSource.indexOf('runNpm(["ci", "--omit=dev", "--ignore-scripts"]');
    const productionRebuild = bundleSource.indexOf('runNpm(["rebuild", "--omit=dev"]');
    const stageCopy = bundleSource.indexOf('await cp(join(primeBuild.path, "node_modules")');
    assert.ok(productionCi >= 0, "bundle suppresses lifecycle hooks while constructing the production tree");
    assert.ok(productionRebuild > productionCi, "bundle explicitly replays production dependency lifecycle scripts after ci");
    assert.ok(stageCopy > productionRebuild, "bundle stages the production tree only after dependency scripts run");
    assert.ok(bundleSource.includes('"npm ci --omit=dev --ignore-scripts"'), "bundle rechecks pinned build provenance after production tree construction");
    assert.ok(bundleSource.includes('"npm rebuild --omit=dev"'), "bundle rechecks pinned build provenance after lifecycle replay");
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
