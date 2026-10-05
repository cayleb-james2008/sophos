import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import test from "node:test";
import { chmod, mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import * as hardening from "./prepare-dependency-overlay.mjs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { applyExactOverrides, assertLockDeltaIsScoped, assertResolvedLock, assertOverrideReviewMetadata, assertOverrideConstraintsMatchLock, assertRegistryMetadataMatchesPins, prepareDependencyOverlay } from "./prepare-dependency-overlay.mjs";

const overlay = {
  overrides: {
    "undici": {
      version: "7.29.1",
      constraints: ["^7.28.0"],
      integrity: "sha512-undici",
      resolved: "https://registry.npmjs.org/undici/-/undici-7.29.1.tgz",
    },
    "brace-expansion": {
      version: "5.0.12",
      constraints: ["^5.0.5"],
      integrity: "sha512-brace",
      resolved: "https://registry.npmjs.org/brace-expansion/-/brace-expansion-5.0.12.tgz",
    },
  },
};

test("canonicalizes CRLF overlay lock bytes only when the reviewed SHA-256 matches", async () => {
  const lfBytes = Buffer.from('{"lockfileVersion":3}\n', "utf8");
  const expectedSha256 = createHash("sha256").update(lfBytes).digest("hex");
  const crlfBytes = Buffer.from(lfBytes.toString("utf8").replaceAll("\n", "\r\n"), "utf8");

  assert.deepEqual(hardening.canonicalizeOverlayLockBytes(crlfBytes, expectedSha256), lfBytes);
  assert.throws(
    () => hardening.canonicalizeOverlayLockBytes(Buffer.from('{"lockfileVersion":2}\r\n'), expectedSha256),
    /overlay lock SHA-256 mismatch/i,
  );
  assert.throws(
    () => hardening.canonicalizeOverlayLockBytes(Buffer.from("{\"lockfileVersion\":3}\r", "utf8"), expectedSha256),
    /standalone carriage return/i,
  );
  assert.throws(
    () => hardening.canonicalizeOverlayLockBytes(crlfBytes, "bad-hash"),
    /expected overlay lock SHA-256/i,
  );
  const reviewed = JSON.parse(await readFile(new URL("./dependency-hardening-overlay.json", import.meta.url), "utf8"));
  const pinnedLockBytes = await readFile(new URL("./dependency-hardening/prime-agent-package-lock.json", import.meta.url));
  const canonicalPinnedLockBytes = Buffer.from(pinnedLockBytes.toString("utf8").replace(/\r\n/g, "\n"), "utf8");
  const windowsCheckedOutBytes = Buffer.from(
    canonicalPinnedLockBytes.toString("utf8").replaceAll("\n", "\r\n"),
    "utf8",
  );
  assert.deepEqual(
    hardening.canonicalizeOverlayLockBytes(windowsCheckedOutBytes, reviewed.overlayLockSha256),
    canonicalPinnedLockBytes,
  );
});

test("applies exact semver-compatible overrides without mutating the upstream manifest", () => {
  const original = { overrides: { rimraf: "6.1.2", "shell-quote": "^1.10.0" }, dependencies: { minimatch: "^10.2.3" } };
  const result = applyExactOverrides(original, overlay);

  assert.deepEqual(result.overrides, {
    rimraf: "6.1.2",
    "shell-quote": "^1.10.0",
    undici: "7.29.1",
    "brace-expansion": "5.0.12",
  });
  assert.equal(original.overrides.undici, undefined);
  assert.deepEqual(original.dependencies, { minimatch: "^10.2.3" });
});

test("rejects an overlay pin that conflicts with an existing override", () => {
  assert.throws(
    () => applyExactOverrides({ overrides: { undici: "7.28.0" } }, overlay),
    /conflicts with existing override.*undici/i,
  );
});

test("rejects non-exact or cross-major overlay pins", () => {
  const incompatible = { overrides: { undici: { ...overlay.overrides.undici, version: "8.0.0" } } };
  assert.throws(() => applyExactOverrides({}, incompatible), /not semver-compatible.*undici/i);

  const ranged = { overrides: { undici: { ...overlay.overrides.undici, version: "^7.29.1" } } };
  assert.throws(() => applyExactOverrides({}, ranged), /undici overlay version must be an exact x.y.z version/i);

  const imprecise = { overrides: { tiny: { version: "9007199254740993.0.0", constraints: ["^9007199254740992.0.0"] } } };
  assert.throws(() => applyExactOverrides({}, imprecise), /safe integer/i);
  const impreciseConstraint = { overrides: { tiny: { version: "0.0.1", constraints: ["^0.9007199254740992.0"] } } };
  assert.throws(() => applyExactOverrides({}, impreciseConstraint), /safe integer/i);
});

test("rejects false zero-major caret ranges, including ^0.0.x patch-only ranges", () => {
  const incompatible = [
    { version: "0.3.0", constraint: "^0.2.3" },
    { version: "0.1.3", constraint: "^0.0.3" },
    { version: "0.0.4", constraint: "^0.0.3" },
    { version: "0.2.0", constraint: "^0.1.3" },
  ];
  for (const { version, constraint } of incompatible) {
    const candidate = { overrides: { tiny: { version, constraints: [constraint] } } };
    assert.throws(() => applyExactOverrides({}, candidate), /not semver-compatible.*tiny/i);
  }
  const exact = { overrides: { tiny: { version: "0.0.3", constraints: ["^0.0.3"] } } };
  assert.doesNotThrow(() => applyExactOverrides({}, exact));
  const sameMinor = { overrides: { tiny: { version: "0.1.99", constraints: ["^0.1.3"] } } };
  assert.doesNotThrow(() => applyExactOverrides({}, sameMinor));
});

test("enforces the recorded seven-day release-age policy without an override", () => {
  const reviewed = {
    npmPolicy: { minimumReleaseAgeDays: 7, releaseAgeOverrideUsed: false },
    overrides: Object.fromEntries(Object.entries(overlay.overrides).map(([name, pin]) => [name, {
      ...pin,
      license: "MIT",
      publishedAt: "2026-09-01T00:00:00.000Z",
    }])),
  };
  const now = new Date("2026-10-04T00:00:00.000Z");

  assert.doesNotThrow(() => assertOverrideReviewMetadata(reviewed, now));
  reviewed.overrides.undici.publishedAt = "2026-10-01T00:00:00.000Z";
  assert.throws(() => assertOverrideReviewMetadata(reviewed, now), /minimum release age/i);
  reviewed.overrides.undici.publishedAt = "2026-09-01T00:00:00.000Z";
  reviewed.npmPolicy.releaseAgeOverrideUsed = true;
  assert.throws(() => assertOverrideReviewMetadata(reviewed, now), /release-age override/i);
});

test("compares recorded pin metadata with primary npm registry responses", async () => {
  const publishedAt = "2026-09-01T00:00:00.000Z";
  const registry = "https://registry.npmjs.org/";
  const reviewed = {
    registry,
    npmPolicy: { minimumReleaseAgeDays: 7, releaseAgeOverrideUsed: false },
    overrides: Object.fromEntries(Object.entries(overlay.overrides).map(([name, pin]) => [name, {
      ...pin,
      engines: { node: ">=20.18.1" },
      license: "MIT",
      publishedAt,
      resolved: `${registry}${name}/-/${name}-${pin.version}.tgz`,
    }])),
  };
  const calls = [];
  const mockFetch = async (input) => {
    const url = String(input);
    calls.push(url);
    const pinEntry = Object.entries(reviewed.overrides).find(([name, pin]) =>
      url === `${registry}${name}/${pin.version}` || url === `${registry}${name}`);
    assert.ok(pinEntry, `unexpected registry URL: ${url}`);
    const [name, pin] = pinEntry;
    const body = url.endsWith(`/${pin.version}`)
      ? { name, version: pin.version, license: "MIT", engines: pin.engines, dist: {
          integrity: pin.integrity,
          tarball: pin.resolved,
        } }
      : { name, time: { [pin.version]: publishedAt } };
    return {
      status: 200,
      url,
      headers: { get: (name) => name.toLowerCase() === "date" ? "Sun, 04 Oct 2026 00:00:00 GMT" : null },
      json: async () => body,
    };
  };

  const validatedAt = await assertRegistryMetadataMatchesPins(reviewed, mockFetch);
  assert.equal(validatedAt, "2026-10-04T00:00:00.000Z");
  assert.equal(calls.length, 4);
  const offOrigin = structuredClone(reviewed);
  offOrigin.overrides.undici.resolved = "https://registry.npmjs.org.attacker.invalid/undici/-/undici-7.29.1.tgz";
  const offOriginFetch = async (input) => {
    const response = await mockFetch(input);
    if (String(input) === `${registry}undici/7.29.1`) {
      const body = await response.json();
      body.dist.tarball = offOrigin.overrides.undici.resolved;
      return { ...response, json: async () => body };
    }
    return response;
  };
  await assert.rejects(
    assertRegistryMetadataMatchesPins(offOrigin, offOriginFetch),
    /tarball URL must stay on the configured npm registry origin/i,
  );
  const mismatchingFetch = async (input) => {
    const response = await mockFetch(input);
    const url = String(input);
    if (url === `${registry}undici/7.29.1`) {
      const body = await response.json();
      body.dist.integrity = "sha512-mismatch";
      return { ...response, json: async () => body };
    }
    return response;
  };
  await assert.rejects(
    assertRegistryMetadataMatchesPins(reviewed, mismatchingFetch),
    /npm registry integrity mismatch.*undici/i,
  );
  const mismatchingEngineFetch = async (input) => {
    const response = await mockFetch(input);
    if (String(input) === `${registry}undici/7.29.1`) {
      const body = await response.json();
      return { ...response, json: async () => ({ ...body, engines: { node: ">=18" } }) };
    }
    return response;
  };
  await assert.rejects(
    assertRegistryMetadataMatchesPins(reviewed, mismatchingEngineFetch),
    /registry engine constraint mismatch.*undici/i,
  );
  const tooRecentFetch = async (input) => {
    const response = await mockFetch(input);
    return {
      ...response,
      headers: { get: (name) => name.toLowerCase() === "date" ? "Fri, 04 Sep 2026 00:00:00 GMT" : null },
    };
  };
  await assert.rejects(
    assertRegistryMetadataMatchesPins(reviewed, tooRecentFetch),
    /minimum release age of 7 days/i,
  );
});

test("requires the recorded constraints to match every lockfile dependency edge", () => {
  const lock = {
    lockfileVersion: 3,
    packages: {
      "packages/ai": { dependencies: { undici: "^7.28.0" } },
      "packages/coding-agent": { dependencies: { undici: "^7.28.0" } },
    },
  };
  const reviewed = { overrides: { undici: overlay.overrides.undici } };

  assert.doesNotThrow(() => assertOverrideConstraintsMatchLock(lock, reviewed));
  lock.packages["node_modules/unexpected-parent"] = { optionalDependencies: { undici: "^7.0.0" } };
  assert.throws(
    () => assertOverrideConstraintsMatchLock(lock, reviewed),
    /lock dependency constraints mismatch.*undici/i,
  );
});

test("includes workspace devDependencies when recording upstream constraints", () => {
  const lock = {
    lockfileVersion: 3,
    packages: {
      "": { devDependencies: { undici: "^7.0.0" } },
      "packages/coding-agent": { dependencies: { undici: "^7.28.0" } },
    },
  };
  assert.throws(
    () => assertOverrideConstraintsMatchLock(lock, { overrides: { undici: overlay.overrides.undici } }),
    /lock dependency constraints mismatch.*undici/i,
  );
});

test("verifies exact versions, registry URLs, and integrity values in the locked graph", () => {
  const lock = {
    lockfileVersion: 3,
    packages: {
      "node_modules/undici": {
        version: "7.29.1",
        resolved: "https://registry.npmjs.org/undici/-/undici-7.29.1.tgz",
        integrity: "sha512-undici",
      },
      "node_modules/brace-expansion": {
        version: "5.0.12",
        resolved: "https://registry.npmjs.org/brace-expansion/-/brace-expansion-5.0.12.tgz",
        integrity: "sha512-brace",
      },
    },
  };

  assert.doesNotThrow(() => assertResolvedLock(lock, overlay));
  lock.packages["node_modules/parent/node_modules/undici"] = {
    version: "7.28.0",
    resolved: "https://registry.npmjs.org/undici/-/undici-7.28.0.tgz",
    integrity: "sha512-old-undici",
  };
  assert.throws(() => assertResolvedLock(lock, overlay), /lock version mismatch.*undici/i);
  delete lock.packages["node_modules/parent/node_modules/undici"];
  lock.packages["node_modules/undici"].version = "7.28.0";
  assert.throws(() => assertResolvedLock(lock, overlay), /lock version mismatch.*undici/i);
});

test("validates scoped package tarball URLs from the reviewed registry pin", () => {
  const resolved = "https://registry.npmjs.org/@scope/pkg/-/pkg-1.2.3.tgz";
  const scopedOverlay = {
    overrides: {
      "@scope/pkg": { version: "1.2.3", constraints: ["^1.0.0"], resolved, integrity: "sha512-scoped" },
    },
  };
  const lock = {
    lockfileVersion: 3,
    packages: {
      "node_modules/@scope/pkg": { version: "1.2.3", resolved, integrity: "sha512-scoped" },
    },
  };
  assert.doesNotThrow(() => assertResolvedLock(lock, scopedOverlay));
});

test("permits only the explicitly reviewed lock-node changes", () => {
  const base = {
    lockfileVersion: 3,
    packages: {
      "": { name: "prime-agent", version: "0.7.0" },
      "node_modules/undici": { version: "7.28.0", resolved: "old", integrity: "old" },
      "node_modules/brace-expansion": { version: "5.0.7", resolved: "old", integrity: "old" },
      "node_modules/unrelated": { version: "1.2.3", resolved: "fixed", integrity: "sha512-other" },
    },
  };
  const candidate = structuredClone(base);
  candidate.packages["node_modules/undici"] = { version: "7.29.1", resolved: "new", integrity: "sha512-undici" };
  candidate.packages["node_modules/brace-expansion"] = { version: "5.0.12", resolved: "new", integrity: "sha512-brace" };
  candidate.packages["node_modules/undici"].dependencies = { "unreviewed-package": "^1.0.0" };
  assert.throws(
    () => assertLockDeltaIsScoped(base, candidate, overlay),
    /unreviewed metadata for overridden package.*undici.*dependencies/i,
  );
  delete candidate.packages["node_modules/undici"].dependencies;
  assert.doesNotThrow(() => assertLockDeltaIsScoped(base, candidate, overlay));
  for (const field of ["name", "version", "requires"]) {
    const topLevelMutation = structuredClone(candidate);
    topLevelMutation[field] = field === "requires" ? false : "unreviewed";
    assert.throws(
      () => assertLockDeltaIsScoped(base, topLevelMutation, overlay),
      new RegExp(`unreviewed top-level metadata: ${field}`),
    );
  }

  candidate.packages["node_modules/unrelated"].version = "1.2.4";
  assert.throws(() => assertLockDeltaIsScoped(base, candidate, overlay), /unreviewed package metadata.*unrelated/i);
});

test("exposes Windows ACL inspection and trusted-path policy APIs", () => {
  assert.equal(typeof hardening.inspectWindowsPathAcl, "function");
  assert.equal(typeof hardening.assertWindowsPathAcl, "function");
});

test("supports Windows only through its separately validated ACL policy", () => {
  assert.equal(typeof hardening.assertSafeFilesystemPlatform, "function");
  assert.doesNotThrow(() => hardening.assertSafeFilesystemPlatform("linux"));
  assert.doesNotThrow(() => hardening.assertSafeFilesystemPlatform("win32"));
  for (const platform of ["darwin", "freebsd"]) {
    assert.throws(() => hardening.assertSafeFilesystemPlatform(platform), /supports only Linux and Windows NTFS/i);
  }
});

test("accepts a non-reparse 8.3 path alias for a secure Windows source root", { skip: process.platform !== "win32" }, async (t) => {
  const sourceRoot = await mkdtemp(join(tmpdir(), "sophos-short-name-source-"));
  const normalized = (path) => path.toLowerCase();
  try {
    const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
    const systemRoot = process.env.SystemRoot ?? process.env.WINDIR ?? "C:\\Windows";
    const pwsh = join(programFiles, "PowerShell", "7", "pwsh.exe");
    const powershell = existsSync(pwsh)
      ? pwsh
      : join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const pathPayload = Buffer.from(JSON.stringify(sourceRoot), "utf8").toString("base64");
    const script = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$source = @'
using System.Runtime.InteropServices;
using System.Text;
public static class SophosPathAliasNative {
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern uint GetShortPathName(string longPath, StringBuilder shortPath, uint capacity);
}
'@
Add-Type -TypeDefinition $source
$longPath = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${pathPayload}'))
$buffer = [System.Text.StringBuilder]::new(32768)
$length = [SophosPathAliasNative]::GetShortPathName($longPath, $buffer, [uint32]$buffer.Capacity)
if ($length -eq 0 -or $length -ge $buffer.Capacity) {
    $errorCode = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
    throw "GetShortPathName failed: Win32 error $errorCode"
}
[Console]::WriteLine($buffer.ToString())
`;
    const encodedScript = Buffer.from(script, "utf16le").toString("base64");
    const shortPathResult = spawnSync(powershell, [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodedScript,
    ], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 15_000,
      maxBuffer: 1024 * 1024,
      env: {
        SystemRoot: systemRoot,
        WINDIR: systemRoot,
        ProgramFiles: programFiles,
        TEMP: process.env.TEMP ?? tmpdir(),
        TMP: process.env.TMP ?? tmpdir(),
        USERPROFILE: process.env.USERPROFILE ?? "",
        PATH: [dirname(powershell), join(systemRoot, "System32")].join(delimiter),
      },
    });
    assert.equal(shortPathResult.error, undefined, shortPathResult.error?.message);
    assert.equal(shortPathResult.status, 0, shortPathResult.stderr || shortPathResult.stdout);
    const shortPath = shortPathResult.stdout.trim();
    assert.ok(shortPath, "GetShortPathName must return the native short path for the fixture");
    const hasDosShortName = shortPath.split(String.fromCharCode(92)).some((component) => /^.{1,6}~\d+$/i.test(component));
    if (!hasDosShortName || normalized(shortPath) === normalized(sourceRoot)) {
      t.skip("the native Windows volume does not expose an 8.3 alias for this fixture");
      return;
    }
    const physicalPath = await realpath(sourceRoot);
    assert.equal(normalized(await realpath(shortPath)), normalized(physicalPath), "the DOS alias must resolve to the exact long-name directory");
    t.diagnostic(`8.3 alias resolves to a non-reparse directory: ${shortPath} -> ${physicalPath}`);
    const record = await hardening.inspectWindowsPathAcl(shortPath);
    assert.equal(record.isReparsePoint, false, "an 8.3 alias does not set FILE_ATTRIBUTE_REPARSE_POINT");
    const secureSourceRoot = await hardening.assertSecureSourceRoot(shortPath, "native Windows 8.3 alias fixture");
    assert.equal(normalized(secureSourceRoot), normalized(physicalPath), "the trusted source path may be canonicalized after the reparse check");
    const secureProjectRoot = await hardening.assertSecureProjectRoot(shortPath);
    assert.equal(normalized(secureProjectRoot), normalized(physicalPath), "the trusted project path may be canonicalized after the reparse check");
  } finally {
    await rm(sourceRoot, { recursive: true, force: true });
  }
});

test("rejects an actual reparse-point ancestor by its Windows attributes", { skip: process.platform !== "win32" }, async () => {
  const workspace = await mkdtemp(join(await realpath(tmpdir()), "sophos-reparse-ancestor-"));
  const actualParent = join(workspace, "actual-parent");
  const junctionParent = join(workspace, "junction-parent");
  const sourceThroughJunction = join(junctionParent, "source");
  try {
    await mkdir(actualParent);
    await mkdir(join(actualParent, "source"));
    await symlink(actualParent, junctionParent, "junction");
    const junction = await hardening.inspectWindowsPathAcl(junctionParent);
    assert.equal(junction.isReparsePoint, true, "the fixture must be a real NTFS reparse point");
    await assert.rejects(
      hardening.assertSecureSourceRoot(sourceThroughJunction, "native Windows junction fixture"),
      /reparse point/i,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("accepts only root- or current-user-owned filesystem ancestors", { skip: process.platform !== "linux" }, () => {
  assert.equal(typeof hardening.assertTrustedAncestorOwner, "function");
  assert.doesNotThrow(() => hardening.assertTrustedAncestorOwner({ uid: 0 }, "/trusted/system", 1000));
  assert.doesNotThrow(() => hardening.assertTrustedAncestorOwner({ uid: 1000 }, "/trusted/user", 1000));
  assert.throws(
    () => hardening.assertTrustedAncestorOwner({ uid: 1001 }, "/untrusted/foreign-owner", 1000),
    /ancestor must be owned by root or the current user/i,
  );
});

test("rejects shared or group-writable pinned source roots", { skip: process.platform !== "linux" }, async () => {
  const workspace = await mkdtemp(join(tmpdir(), "dependency-hardening-source-permissions-"));
  try {
    const unsafeRoot = join(workspace, "unsafe-root");
    await mkdir(unsafeRoot);
    await chmod(unsafeRoot, 0o770);
    assert.equal(typeof hardening.assertSecureSourceRoot, "function");
    await assert.rejects(hardening.assertSecureSourceRoot(unsafeRoot), /owned by the current user and not writable by group or others/i);

    const unsafeParent = join(workspace, "unsafe-parent");
    await mkdir(unsafeParent);
    await chmod(unsafeParent, 0o770);
    const nested = join(unsafeParent, "source");
    await mkdir(nested);
    await assert.rejects(hardening.assertSecureSourceRoot(nested), /writable by others/i);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("rejects unsafe overlay project roots", { skip: process.platform !== "linux" }, async () => {
  const workspace = await mkdtemp(join(tmpdir(), "dependency-hardening-project-root-"));
  try {
    const project = join(workspace, "project");
    await mkdir(project);
    assert.equal(typeof hardening.assertSecureProjectRoot, "function");
    assert.equal(await hardening.assertSecureProjectRoot(project), project);

    const projectLink = join(workspace, "project-link");
    await symlink(project, projectLink, "dir");
    await assert.rejects(hardening.assertSecureProjectRoot(projectLink), /symlink/i);

    await chmod(project, 0o770);
    await assert.rejects(hardening.assertSecureProjectRoot(project), /writable by group or others/i);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("prepare rejects symlinked or group/world-writable policy files before parsing", { skip: process.platform !== "linux" }, async () => {
  const workspace = await mkdtemp(join(tmpdir(), "dependency-hardening-policy-inputs-"));
  try {
    const source = join(workspace, "source");
    const project = join(workspace, "project");
    const scripts = join(project, "scripts");
    const lockDirectory = join(scripts, "dependency-hardening");
    const manifestPath = join(scripts, "dependency-hardening-overlay.json");
    const lockPath = join(lockDirectory, "prime-agent-package-lock.json");
    const manifestTarget = join(workspace, "manifest-target.json");
    const lockTarget = join(workspace, "lock-target.json");
    const destination = join(workspace, "output");
    await Promise.all([mkdir(source), mkdir(lockDirectory, { recursive: true })]);
    await writeFile(manifestTarget, "{}\n");
    await writeFile(lockTarget, "{}\n");

    await symlink(manifestTarget, manifestPath);
    await assert.rejects(
      prepareDependencyOverlay(source, destination, project),
      /symlink.*overlay manifest/i,
    );
    await rm(manifestPath);
    await writeFile(manifestPath, "{}\n");

    await symlink(lockTarget, lockPath);
    await assert.rejects(
      prepareDependencyOverlay(source, destination, project),
      /symlink.*overlay lock/i,
    );
    await rm(lockPath);
    await writeFile(lockPath, "{}\n");

    await chmod(project, 0o770);
    await assert.rejects(
      prepareDependencyOverlay(source, destination, project),
      /dependency overlay project root.*writable by group or others/i,
    );
    await chmod(project, 0o755);

    await chmod(manifestPath, 0o666);
    await assert.rejects(
      prepareDependencyOverlay(source, destination, project),
      /overlay manifest.*writable by group or others/i,
    );
    await chmod(manifestPath, 0o644);
    await chmod(lockPath, 0o666);
    await assert.rejects(
      prepareDependencyOverlay(source, destination, project),
      /overlay lock.*writable by group or others/i,
    );
    await chmod(lockPath, 0o644);

    await chmod(scripts, 0o770);
    await assert.rejects(
      prepareDependencyOverlay(source, destination, project),
      /overlay manifest.*writable by group or others/i,
    );
    await chmod(scripts, 0o755);

    await chmod(lockDirectory, 0o770);
    await assert.rejects(
      prepareDependencyOverlay(source, destination, project),
      /overlay lock.*writable by group or others/i,
    );
    await chmod(lockDirectory, 0o755);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("refuses source-file symlinks before reading pinned manifests", { skip: process.platform !== "linux" }, async () => {
  const workspace = await mkdtemp(join(tmpdir(), "dependency-hardening-source-symlink-"));
  try {
    const source = join(workspace, "source");
    const external = join(workspace, "outside.json");
    await mkdir(source);
    await writeFile(external, "{\"outside\":true}\n");
    await symlink(external, join(source, "package.json"));
    assert.equal(typeof hardening.assertRegularFileNoSymlink, "function");
    await assert.rejects(
      hardening.assertRegularFileNoSymlink(source, ["package.json"], "Prime Agent root package.json"),
      /symlink/i,
    );
    assert.equal(await readFile(external, "utf8"), "{\"outside\":true}\n");

    const sharedLock = join(source, "package-lock.json");
    await writeFile(sharedLock, "{}\n");
    await chmod(sharedLock, 0o666);
    await assert.rejects(
      hardening.assertRegularFileNoSymlink(source, ["package-lock.json"], "Prime Agent package-lock.json"),
      /writable by group or others/i,
    );

    const packageDir = join(source, "packages");
    await symlink(workspace, packageDir, process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(
      hardening.assertRegularFileNoSymlink(source, ["packages", "coding-agent", "package.json"], "Prime Agent coding-agent package.json"),
      /symlink/i,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("cleans partial temporary files when atomic replacement writes fail", { skip: process.platform !== "linux" }, async () => {
  const workspace = await mkdtemp(join(tmpdir(), "dependency-hardening-write-failure-"));
  try {
    const destination = join(workspace, "destination");
    await mkdir(destination);
    const manifestPath = join(destination, "package.json");
    await writeFile(manifestPath, "{\"old\":true}\n");
    async function* failingPayload() {
      yield Buffer.from("partial overlay content");
      throw new Error("injected stream write failure");
    }
    await assert.rejects(hardening.replaceRegularFileSafely(manifestPath, failingPayload()), /injected stream write failure/);
    assert.equal(await readFile(manifestPath, "utf8"), "{\"old\":true}\n");
    assert.deepEqual(await readdir(destination), ["package.json"]);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("atomically replaces an existing regular manifest and removes its temporary file", { skip: process.platform !== "linux" }, async () => {
  const workspace = await mkdtemp(join(tmpdir(), "dependency-hardening-atomic-replace-"));
  try {
    const destination = join(workspace, "destination");
    await mkdir(destination);
    const manifestPath = join(destination, "package.json");
    await writeFile(manifestPath, "{\"old\":true}\n");
    assert.equal(typeof hardening.replaceRegularFileSafely, "function");
    await hardening.replaceRegularFileSafely(manifestPath, "{\"overrides\":{}}\n");
    assert.equal(await readFile(manifestPath, "utf8"), "{\"overrides\":{}}\n");
    assert.deepEqual(await readdir(destination), ["package.json"]);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("refuses to replace a symlinked manifest without touching its target", { skip: process.platform !== "linux" }, async () => {
  const workspace = await mkdtemp(join(tmpdir(), "dependency-hardening-write-symlink-"));
  try {
    const destination = join(workspace, "destination");
    const external = join(workspace, "outside.json");
    await mkdir(destination);
    await writeFile(external, "{\"outside\":true}\n");
    const manifestPath = join(destination, "package.json");
    await symlink(external, manifestPath);
    assert.equal(typeof hardening.replaceRegularFileSafely, "function");
    await assert.rejects(
      hardening.replaceRegularFileSafely(manifestPath, "{\"overrides\":{}}\n"),
      /symlink/i,
    );
    assert.equal(await readFile(external, "utf8"), "{\"outside\":true}\n");
    assert.equal((await readdir(destination)).length, 1);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("resolves symlinked parents and rejects existing destination symlinks", { skip: process.platform !== "linux" }, async () => {
  const workspace = await mkdtemp(join(tmpdir(), "dependency-hardening-path-"));
  try {
    const source = join(workspace, "source");
    const other = join(workspace, "other");
    await mkdir(source);
    await mkdir(other);
    const directoryLinkType = process.platform === "win32" ? "junction" : "dir";
    const sourceAlias = join(workspace, "source-alias");
    await symlink(source, sourceAlias, directoryLinkType);
    await assert.rejects(
      prepareDependencyOverlay(source, join(sourceAlias, "overlay"), workspace),
      /source and overlay checkout paths must be disjoint/i,
    );

    const destinationAlias = join(workspace, "destination-alias");
    await symlink(other, destinationAlias, directoryLinkType);
    await assert.rejects(
      prepareDependencyOverlay(source, destinationAlias, workspace),
      /overlay destination already exists/i,
    );
    assert.deepEqual(await readdir(other), []);

    if (process.platform !== "win32") {
      const unsafeParent = join(workspace, "unsafe-parent");
      await mkdir(unsafeParent, { mode: 0o770 });
      await chmod(unsafeParent, 0o770);
      await assert.rejects(
        prepareDependencyOverlay(source, join(unsafeParent, "overlay"), workspace),
        /writable by others without the sticky bit/i,
      );
    }
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
