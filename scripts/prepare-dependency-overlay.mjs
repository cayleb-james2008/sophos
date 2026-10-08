#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { open, lstat, mkdir, readFile, realpath, rename, rm, rmdir } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import {
  assertSecureWindowsPath,
  assertWindowsPathAcl,
  inspectWindowsPathAcl,
} from "./dependency-hardening/windows-acl-security.mjs";

export { assertSecureWindowsPath, assertWindowsPathAcl, inspectWindowsPathAcl };

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
// Trust boundary: callers must use an exclusive per-user workspace. Linux
// paths retain root/current-UID ownership and private-parent checks; Windows
// paths use the separately validated NTFS ACL policy. Neither is a sandbox
// against a hostile process running as the same UID/user.
const VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  if (result.error) throw new Error(`${command} ${args.join(" ")} could not start: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = `${result.stderr ?? ""}${result.stdout ?? ""}`.trim();
    throw new Error(`${command} ${args.join(" ")} failed (${result.status})${detail ? `: ${detail}` : ""}`);
  }
  return (result.stdout ?? "").trim();
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function canonicalizeOverlayLockBytes(bytes, expectedSha256) {
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) {
    throw new Error("overlay lock bytes must be a Buffer");
  }
  if (typeof expectedSha256 !== "string" || !/^[a-f0-9]{64}$/.test(expectedSha256)) {
    throw new Error("expected overlay lock SHA-256 must be 64 lowercase hexadecimal characters");
  }
  const normalizedText = Buffer.from(bytes).toString("utf8").replace(/\r\n/g, "\n");
  if (normalizedText.includes("\r")) {
    throw new Error("overlay lock contains a standalone carriage return");
  }
  const normalizedBytes = Buffer.from(normalizedText, "utf8");
  if (sha256(normalizedBytes) !== expectedSha256) {
    throw new Error("overlay lock SHA-256 mismatch after line-ending normalization");
  }
  return normalizedBytes;
}

export function assertSafeFilesystemPlatform(platform = process.platform) {
  if (platform !== "linux" && platform !== "win32") {
    throw new Error("dependency overlay preparation supports only Linux and Windows NTFS permission validation");
  }
}

function parseVersion(version, label) {
  const match = VERSION_RE.exec(version);
  if (!match) throw new Error(`${label} must be an exact x.y.z version: ${version}`);
  const components = match.slice(1).map(Number);
  if (components.some((component) => !Number.isSafeInteger(component))) {
    throw new Error(`${label} version components must be safe integers: ${version}`);
  }
  return components;
}

function assertNpmTarballUrl(registry, packageName, version, resolved) {
  let registryUrl;
  let tarballUrl;
  try {
    registryUrl = new URL(registry);
    tarballUrl = new URL(resolved);
  } catch {
    throw new Error(`invalid npm registry tarball URL for ${packageName}`);
  }
  const packageBaseName = packageName.split("/").at(-1);
  const tarballName = `${packageBaseName}-${version}.tgz`;
  const expectedPrefixes = [
    `/${packageName}/-/`,
    `/${encodeURIComponent(packageName)}/-/`,
  ];
  if (tarballUrl.protocol !== "https:" || tarballUrl.origin !== registryUrl.origin
    || tarballUrl.username || tarballUrl.password || tarballUrl.search || tarballUrl.hash
    || !expectedPrefixes.some((prefix) => tarballUrl.pathname === `${prefix}${tarballName}`)) {
    throw new Error(`npm registry tarball URL must stay on the configured npm registry origin for ${packageName}`);
  }
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function assertOverrideVersionCompatible(packageName, version, constraints) {
  if (!Array.isArray(constraints) || constraints.length === 0) {
    throw new Error(`overlay must record the upstream semver constraints for ${packageName}`);
  }
  const target = parseVersion(version, `${packageName} overlay version`);
  for (const constraint of constraints) {
    const caretMatch = /^\^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(constraint);
    const exactMatch = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(constraint);
    const match = caretMatch ?? exactMatch;
    if (!match) throw new Error(`unsupported upstream semver constraint for ${packageName}: ${constraint}`);
    const base = parseVersion(match.slice(1).join("."), `${packageName} upstream semver constraint`);
    const comparison = compareVersions(target, base);
    if (exactMatch) {
      if (target[0] !== base[0] || comparison < 0) {
        throw new Error(`overlay version ${version} is not semver-compatible with ${constraint} for ${packageName}`);
      }
      continue;
    }
    const compatibleMajor = target[0] === base[0];
    const compatibleZeroMinor = base[0] !== 0 || target[1] === base[1];
    const compatibleZeroPatch = base[0] !== 0 || base[1] !== 0 || target[2] === base[2];
    if (!compatibleMajor || !compatibleZeroMinor || !compatibleZeroPatch || comparison < 0) {
      throw new Error(`overlay version ${version} is not semver-compatible with ${constraint} for ${packageName}`);
    }
  }
}

export function assertOverrideReviewMetadata(overlay, now = new Date()) {
  const minimumAgeDays = overlay?.npmPolicy?.minimumReleaseAgeDays;
  if (!Number.isSafeInteger(minimumAgeDays) || minimumAgeDays < 7) {
    throw new Error("dependency overlay must require a minimum release age of at least 7 days");
  }
  if (overlay.npmPolicy.releaseAgeOverrideUsed !== false) {
    throw new Error("dependency overlay must not use a release-age override");
  }
  const nowMillis = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(nowMillis)) throw new Error("dependency overlay review time is invalid");
  for (const [packageName, pin] of Object.entries(overlay.overrides ?? {})) {
    if (typeof pin?.license !== "string" || !pin.license.trim()) {
      throw new Error(`overlay must record the npm registry license for ${packageName}`);
    }
    const publishedAt = typeof pin.publishedAt === "string" ? Date.parse(pin.publishedAt) : Number.NaN;
    if (!Number.isFinite(publishedAt)) {
      throw new Error(`overlay must record a valid npm registry publication time for ${packageName}`);
    }
    const ageDays = (nowMillis - publishedAt) / 86_400_000;
    if (ageDays < minimumAgeDays) {
      throw new Error(`overlay version for ${packageName} does not meet the minimum release age of ${minimumAgeDays} days`);
    }
  }
}

export async function assertRegistryMetadataMatchesPins(overlay, fetchImpl = globalThis.fetch) {
  const registry = overlay?.registry;
  if (registry !== "https://registry.npmjs.org/") {
    throw new Error("dependency overlay must use the public npm registry over HTTPS");
  }
  if (typeof fetchImpl !== "function") throw new Error("runtime does not provide HTTPS fetch for npm registry review");
  const registryTimes = [];
  for (const [packageName, pin] of Object.entries(overlay.overrides ?? {})) {
    if (!/^(?:[a-z0-9][a-z0-9._-]*|@[a-z0-9._-]+\/[a-z0-9._-]+)$/.test(packageName)) {
      throw new Error(`invalid npm package name in dependency overlay: ${packageName}`);
    }
    parseVersion(pin.version, `${packageName} overlay version`);
    assertNpmTarballUrl(registry, packageName, pin.version, pin.resolved);
    const versionUrl = `${registry}${encodeURIComponent(packageName)}/${pin.version}`;
    const packageUrl = `${registry}${encodeURIComponent(packageName)}`;
    const fetchJson = async (url) => {
      let response;
      try {
        response = await fetchImpl(url, {
          headers: { accept: "application/json" },
          redirect: "error",
          signal: AbortSignal.timeout(15_000),
        });
      } catch (error) {
        throw new Error(`npm registry request failed for ${packageName}: ${error.message}`);
      }
      if (response.status !== 200 || (response.url && response.url !== url)) {
        throw new Error(`npm registry returned an unexpected response for ${packageName}: HTTP ${response.status}`);
      }
      const serverTime = Date.parse(response.headers?.get?.("date") ?? "");
      if (!Number.isFinite(serverTime)) {
        throw new Error(`npm registry HTTP Date header is missing or invalid for ${packageName}`);
      }
      return { body: await response.json(), serverTime };
    };
    const [versionResponse, packageResponse] = await Promise.all([fetchJson(versionUrl), fetchJson(packageUrl)]);
    const { body: metadata, serverTime } = versionResponse;
    const { body: packageDocument, serverTime: packageServerTime } = packageResponse;
    registryTimes.push(Math.min(serverTime, packageServerTime));
    if (metadata.name !== packageName || metadata.version !== pin.version) {
      throw new Error(`npm registry package identity mismatch for ${packageName}`);
    }
    if (metadata.dist?.resolved && metadata.dist.resolved !== pin.resolved) {
      throw new Error(`npm registry resolved URL mismatch for ${packageName}`);
    }
    if (metadata.dist?.tarball !== pin.resolved) {
      throw new Error(`npm registry tarball URL mismatch for ${packageName}`);
    }
    if (metadata.dist?.integrity !== pin.integrity) {
      throw new Error(`npm registry integrity mismatch for ${packageName}`);
    }
    if (metadata.license !== pin.license) {
      throw new Error(`npm registry license mismatch for ${packageName}`);
    }
    if (!isDeepStrictEqual(metadata.engines, pin.engines)) {
      throw new Error(`npm registry engine constraint mismatch for ${packageName}`);
    }
    if (packageDocument.time?.[pin.version] !== pin.publishedAt) {
      throw new Error(`npm registry publication time mismatch for ${packageName}`);
    }
  }
  if (registryTimes.length === 0) throw new Error("dependency overlay has no registry review pins");
  const validatedAt = new Date(Math.min(...registryTimes));
  assertOverrideReviewMetadata(overlay, validatedAt);
  return validatedAt.toISOString();
}

export function applyExactOverrides(packageJson, overlay) {
  if (!packageJson || typeof packageJson !== "object" || Array.isArray(packageJson)) {
    throw new Error("upstream package.json must be a JSON object");
  }
  if (!overlay?.overrides || typeof overlay.overrides !== "object" || Array.isArray(overlay.overrides)) {
    throw new Error("dependency overlay has no override map");
  }

  const result = structuredClone(packageJson);
  result.overrides = { ...(result.overrides ?? {}) };
  for (const [packageName, pin] of Object.entries(overlay.overrides)) {
    if (!pin || typeof pin !== "object") throw new Error(`invalid override record for ${packageName}`);
    parseVersion(pin.version, `${packageName} overlay version`);
    assertOverrideVersionCompatible(packageName, pin.version, pin.constraints);
    const hasExistingOverride = Object.hasOwn(result.overrides, packageName);
    if (pin.replaceExisting !== undefined && typeof pin.replaceExisting !== "string") {
      throw new Error(`overlay replacement range must be a string for ${packageName}`);
    }
    if (pin.replaceExisting !== undefined
      && (!hasExistingOverride
        || (result.overrides[packageName] !== pin.replaceExisting && result.overrides[packageName] !== pin.version))) {
      throw new Error(`overlay conflicts with existing override for ${packageName}: ${result.overrides[packageName] ?? "missing"}`);
    }
    if (hasExistingOverride && result.overrides[packageName] !== pin.version && pin.replaceExisting === undefined) {
      throw new Error(`overlay conflicts with existing override for ${packageName}: ${result.overrides[packageName]}`);
    }
    result.overrides[packageName] = pin.version;
  }
  return result;
}

function packageInstallLocations(lock, packageName) {
  const rootLocation = `node_modules/${packageName}`;
  const nestedSuffix = `/node_modules/${packageName}`;
  return Object.keys(lock.packages ?? {})
    .filter((location) => location === rootLocation || location.endsWith(nestedSuffix))
    .sort();
}

export function assertResolvedLock(lock, overlay) {
  if (lock?.lockfileVersion !== 3 || !lock.packages || typeof lock.packages !== "object") {
    throw new Error("dependency overlay lock must use npm lockfileVersion 3");
  }
  for (const [packageName, pin] of Object.entries(overlay.overrides ?? {})) {
    const locations = packageInstallLocations(lock, packageName);
    if (locations.length === 0) throw new Error(`lock entry missing for ${packageName}`);
    for (const location of locations) {
      const entry = lock.packages[location];
      if (!entry || entry.version !== pin.version) {
        throw new Error(`lock version mismatch for ${packageName} at ${location}: expected ${pin.version}, found ${entry?.version ?? "missing"}`);
      }
      if (entry.resolved !== pin.resolved) {
        throw new Error(`lock registry URL mismatch for ${packageName} at ${location}: expected ${pin.resolved}, found ${entry.resolved ?? "missing"}`);
      }
      if (entry.integrity !== pin.integrity) {
        throw new Error(`lock integrity mismatch for ${packageName} at ${location}: expected ${pin.integrity}, found ${entry.integrity ?? "missing"}`);
      }
      if (!isDeepStrictEqual(entry.engines, pin.engines)) {
        throw new Error(`lock engine constraint mismatch for ${packageName} at ${location}`);
      }
    }
  }
}

export function assertOverrideConstraintsMatchLock(lock, overlay) {
  if (!lock?.packages || typeof lock.packages !== "object") {
    throw new Error("upstream Prime Agent lock has no package graph");
  }
  for (const [packageName, pin] of Object.entries(overlay.overrides ?? {})) {
    const observedConstraints = new Set();
    for (const entry of Object.values(lock.packages)) {
      for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
        const spec = entry?.[field]?.[packageName];
        if (spec !== undefined) {
          if (typeof spec !== "string") throw new Error(`invalid upstream dependency constraint for ${packageName}`);
          observedConstraints.add(spec);
        }
      }
    }
    const observed = [...observedConstraints].sort();
    const recorded = [...new Set(pin?.constraints ?? [])].sort();
    if (observed.length === 0 || !isDeepStrictEqual(observed, recorded)) {
      throw new Error(`lock dependency constraints mismatch for ${packageName}: expected ${recorded.join(", ") || "none"}, found ${observed.join(", ") || "none"}`);
    }
    assertOverrideVersionCompatible(packageName, pin.version, observed);
  }
}

export function assertLockDeltaIsScoped(baseLock, overlayLock, overlay) {
  for (const field of new Set([...Object.keys(baseLock), ...Object.keys(overlayLock)])) {
    if (field !== "packages" && !isDeepStrictEqual(baseLock[field], overlayLock[field])) {
      throw new Error(`overlay lock changes unreviewed top-level metadata: ${field}`);
    }
  }
  if (baseLock.lockfileVersion !== overlayLock.lockfileVersion) {
    throw new Error("overlay lock changes npm lockfile format");
  }
  const baseKeys = Object.keys(baseLock.packages ?? {}).sort();
  const overlayKeys = Object.keys(overlayLock.packages ?? {}).sort();
  if (!isDeepStrictEqual(baseKeys, overlayKeys)) {
    throw new Error("overlay lock changes the dependency graph shape; review is required");
  }
  const allowedEntries = new Map();
  for (const [packageName, pin] of Object.entries(overlay.overrides ?? {})) {
    for (const location of new Set([
      ...packageInstallLocations(baseLock, packageName),
      ...packageInstallLocations(overlayLock, packageName),
    ])) {
      allowedEntries.set(location, { packageName, pin });
    }
  }
  const mutableFields = new Set(["version", "resolved", "integrity", "engines"]);
  for (const key of baseKeys) {
    if (allowedEntries.has(key)) {
      const { packageName, pin } = allowedEntries.get(key);
      const before = baseLock.packages[key];
      const after = overlayLock.packages[key];
      if (!before || !after || !isDeepStrictEqual(after.engines, pin.engines)) {
        throw new Error(`overlay lock has unreviewed engine constraints for ${packageName} at ${key}`);
      }
      for (const field of new Set([...Object.keys(before), ...Object.keys(after)])) {
        if (!mutableFields.has(field) && !isDeepStrictEqual(before[field], after[field])) {
          throw new Error(`overlay lock changes unreviewed metadata for overridden package: ${key}.${field}`);
        }
      }
    } else if (!isDeepStrictEqual(baseLock.packages[key], overlayLock.packages[key])) {
      throw new Error(`overlay lock changes unreviewed package metadata: ${key || "root"}`);
    }
  }
}

function samePath(left, right) {
  const normalizedLeft = resolve(left);
  const normalizedRight = resolve(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function isWithin(parent, child) {
  const rel = relative(parent, child);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

export function assertPathsDisjoint(source, destination) {
  if (isWithin(source, destination) || isWithin(destination, source)) {
    throw new Error("source and overlay checkout paths must be disjoint");
  }
}

export function assertTrustedAncestorOwner(details, path, currentUid) {
  assertSafeFilesystemPlatform();
  const trustedCurrentUid = currentUid ?? process.getuid();
  if (details.uid !== 0 && details.uid !== trustedCurrentUid) {
    throw new Error(`filesystem ancestor must be owned by root or the current user: ${path}`);
  }
}

async function resolveSecureParent(parentPath, label = "overlay destination") {
  assertSafeFilesystemPlatform();
  if (process.platform === "win32") {
    const parent = resolve(parentPath);
    const details = await lstat(parent);
    if (details.isSymbolicLink() || !details.isDirectory()) {
      throw new Error(`${label} parent must be an existing non-reparse directory: ${parent}`);
    }
    await assertSecureWindowsPath(parent, `${label} parent`, { scope: "private", targetType: "directory" });
    const physical = await realpath(parent);
    const physicalDetails = await lstat(physical);
    if (physicalDetails.isSymbolicLink() || !physicalDetails.isDirectory()
      || physicalDetails.dev !== details.dev || physicalDetails.ino !== details.ino) {
      throw new Error(`${label} parent changed during Windows ACL validation`);
    }
    await assertSecureWindowsPath(physical, `${label} parent`, { scope: "private", targetType: "directory" });
    return physical;
  }
  const parent = await realpath(resolve(parentPath));
  const ancestors = [];
  let currentPath = parent;
  while (true) {
    ancestors.unshift(currentPath);
    const nextPath = dirname(currentPath);
    if (nextPath === currentPath) break;
    currentPath = nextPath;
  }
  for (const component of ancestors) {
    const details = await lstat(component);
    if (details.isSymbolicLink() || !details.isDirectory()) {
      throw new Error(`${label} path contains a non-directory or symlink: ${component}`);
    }
    assertTrustedAncestorOwner(details, component);
    const writableByOthers = (details.mode & 0o022) !== 0;
    const sticky = (details.mode & 0o1000) !== 0;
    if (writableByOthers && !sticky) {
      throw new Error(`${label} ancestor is writable by others without the sticky bit: ${component}`);
    }
    if (samePath(component, parent) && details.uid !== process.getuid()) {
      throw new Error(`${label} parent must be owned by the current user: ${parent}`);
    }
    if (samePath(component, parent) && writableByOthers) {
      throw new Error(`${label} parent must not be group- or world-writable: ${parent}`);
    }
  }
  return parent;
}

function assertPrivateSourceEntry(details, path, label) {
  if (process.platform !== "win32"
    && (details.uid !== process.getuid() || (details.mode & 0o022) !== 0)) {
    throw new Error(`${label} must be owned by the current user and not writable by group or others: ${path}`);
  }
}

export async function assertSecureSourceRoot(sourceRoot, label = "pinned Prime Agent source") {
  assertSafeFilesystemPlatform();
  const sourceInput = resolve(sourceRoot);
  const inputInfo = await lstat(sourceInput);
  if (inputInfo.isSymbolicLink() || !inputInfo.isDirectory()) {
    throw new Error(`${label} root must be a non-symlink real directory: ${sourceInput}`);
  }
  if (process.platform === "win32") {
    // NTFS 8.3 aliases can make realpath return a different, equally valid path
    // string. Reject reparse points from the Windows attributes first, then use
    // realpath only to obtain a stable physical name and confirm lstat identity.
    await assertSecureWindowsPath(sourceInput, `${label} root`, { scope: "private", targetType: "directory" });
    const source = await realpath(sourceInput);
    const physicalInfo = await lstat(source);
    if (physicalInfo.isSymbolicLink() || !physicalInfo.isDirectory()
      || physicalInfo.dev !== inputInfo.dev || physicalInfo.ino !== inputInfo.ino) {
      throw new Error(`${label} root changed during Windows ACL validation`);
    }
    await assertSecureWindowsPath(source, `${label} root`, { scope: "private", targetType: "directory" });
    return source;
  }
  const source = await realpath(sourceInput);
  if (!samePath(source, sourceInput)) {
    throw new Error(`${label} path must not traverse symlinked ancestors: ${sourceInput}`);
  }
  const parent = await resolveSecureParent(dirname(source), label);
  if (!samePath(parent, dirname(source))) {
    throw new Error(`${label} parent changed during validation`);
  }
  assertPrivateSourceEntry(inputInfo, source, `${label} root`);
  return source;
}

export async function assertSecureProjectRoot(projectRoot) {
  if (process.platform !== "win32") return assertSecureSourceRoot(projectRoot, "dependency overlay project");
  assertSafeFilesystemPlatform();
  const projectInput = resolve(projectRoot);
  const info = await lstat(projectInput);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error(`dependency overlay project root must be a non-reparse real directory: ${projectInput}`);
  }
  await assertSecureWindowsPath(projectInput, "dependency overlay project root", { scope: "private", targetType: "directory" });
  const physical = await realpath(projectInput);
  const physicalInfo = await lstat(physical);
  if (physicalInfo.isSymbolicLink() || !physicalInfo.isDirectory()
    || physicalInfo.dev !== info.dev || physicalInfo.ino !== info.ino) {
    throw new Error(`dependency overlay project root changed during Windows ACL validation: ${projectInput}`);
  }
  await assertSecureWindowsPath(physical, "dependency overlay project root", { scope: "private", targetType: "directory" });
  return physical;
}

async function resolveDisjointPaths(sourceRoot, destinationRoot) {
  const source = await assertSecureSourceRoot(sourceRoot);
  const destinationInput = resolve(destinationRoot);
  const destinationParent = await resolveSecureParent(dirname(destinationInput));
  const destination = resolve(destinationParent, basename(destinationInput));
  try {
    await lstat(destination);
    throw new Error(`overlay destination already exists: ${destination}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  assertPathsDisjoint(source, destination);
  return { source, destination, destinationParent };
}

async function assertReservedDestination(destination, destinationParent, reservation) {
  const parent = await resolveSecureParent(destinationParent);
  if (!samePath(parent, destinationParent)) {
    throw new Error("overlay destination parent changed during preparation");
  }
  const current = await lstat(destination);
  if (current.isSymbolicLink() || !current.isDirectory()
    || current.dev !== reservation.dev || current.ino !== reservation.ino) {
    throw new Error("overlay destination reservation changed during preparation");
  }
  if (process.platform === "win32") {
    await assertSecureWindowsPath(destination, "overlay destination", { scope: "private", targetType: "directory" });
    const physical = await realpath(destination);
    const physicalInfo = await lstat(physical);
    if (physicalInfo.isSymbolicLink() || !physicalInfo.isDirectory()
      || physicalInfo.dev !== current.dev || physicalInfo.ino !== current.ino) {
      throw new Error("overlay destination no longer resolves to its reserved directory");
    }
    await assertSecureWindowsPath(physical, "overlay destination", { scope: "private", targetType: "directory" });
  } else {
    const physical = await realpath(destination);
    if (!samePath(physical, destination)) {
      throw new Error("overlay destination no longer resolves to its reserved directory");
    }
  }
}

async function removeReservedDestination(destination, destinationParent, reservation) {
  try {
    const parent = await resolveSecureParent(destinationParent);
    if (!samePath(parent, destinationParent)) return;
    const current = await lstat(destination);
    if (!current.isSymbolicLink() && current.isDirectory()
      && current.dev === reservation.dev && current.ino === reservation.ino) {
      if (process.platform === "win32") {
        await assertSecureWindowsPath(destination, "reserved overlay destination cleanup", { scope: "private", targetType: "directory" });
        const physical = await realpath(destination);
        const physicalInfo = await lstat(physical);
        if (physicalInfo.isSymbolicLink() || !physicalInfo.isDirectory()
          || physicalInfo.dev !== current.dev || physicalInfo.ino !== current.ino) return;
        await assertSecureWindowsPath(physical, "reserved overlay destination cleanup", { scope: "private", targetType: "directory" });
      }
      await rm(destination, { recursive: true, force: true });
    }
  } catch {
    // Fail closed: never recursively remove a path that is not the reserved directory.
  }
}

async function removeUnreservedEmptyDestination(destination, destinationParent) {
  try {
    const parent = await resolveSecureParent(destinationParent);
    if (!samePath(parent, destinationParent)) return;
    const current = await lstat(destination);
    if (current.isSymbolicLink() || !current.isDirectory()) return;
    if (process.platform === "win32") {
      await assertSecureWindowsPath(destination, "unreserved overlay destination cleanup", { scope: "private", targetType: "directory" });
      const physical = await realpath(destination);
      const physicalInfo = await lstat(physical);
      if (physicalInfo.isSymbolicLink() || !physicalInfo.isDirectory()
        || physicalInfo.dev !== current.dev || physicalInfo.ino !== current.ino) return;
      await assertSecureWindowsPath(physical, "unreserved overlay destination cleanup", { scope: "private", targetType: "directory" });
    } else {
      const physical = await realpath(destination);
      if (!samePath(physical, destination)) return;
    }
    await rmdir(destination);
  } catch {
    // Fail closed: remove only an empty, real directory in the validated private parent.
  }
}

export async function assertRegularFileNoSymlink(root, components, label) {
  assertSafeFilesystemPlatform();
  if (!Array.isArray(components) || components.length === 0
    || components.some((part) => typeof part !== "string" || !part || part === "." || part === ".." || part.includes("/") || part.includes("\\"))) {
    throw new Error(`invalid pinned source path for ${label}`);
  }
  let current = resolve(root);
  const rootInfo = await lstat(current);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
    throw new Error(`refusing symlink or non-directory pinned source root for ${label}`);
  }
  assertPrivateSourceEntry(rootInfo, current, label);
  for (const [index, part] of components.entries()) {
    current = resolve(current, part);
    const details = await lstat(current);
    if (details.isSymbolicLink()) {
      throw new Error(`refusing symlink in trusted input: ${label}`);
    }
    assertPrivateSourceEntry(details, current, label);
    const finalComponent = index === components.length - 1;
    if (finalComponent ? !details.isFile() : !details.isDirectory()) {
      throw new Error(`refusing non-regular trusted input: ${label}`);
    }
    if (process.platform === "win32") {
      await assertSecureWindowsPath(current, label, {
        scope: finalComponent ? "private" : "ancestor",
        targetType: finalComponent ? "file" : "directory",
      });
    }
  }
  return current;
}

export async function replaceRegularFileSafely(filePath, contents) {
  assertSafeFilesystemPlatform();
  const parent = dirname(filePath);
  const parentInfo = await lstat(parent);
  if (parentInfo.isSymbolicLink() || !parentInfo.isDirectory()) {
    throw new Error(`refusing symlink or non-directory destination parent: ${parent}`);
  }
  const existing = await lstat(filePath);
  if (existing.isSymbolicLink() || !existing.isFile()) {
    throw new Error(`refusing symlink or non-regular destination file: ${filePath}`);
  }
  if (process.platform === "win32") {
    await assertSecureWindowsPath(parent, "atomic replacement parent", { scope: "private", targetType: "directory" });
    await assertSecureWindowsPath(filePath, "atomic replacement target", { scope: "private", targetType: "file" });
  }

  const temporaryPath = resolve(parent, `.${basename(filePath)}.${randomUUID()}.tmp`);
  let temporaryHandle;
  let temporaryExists = false;
  try {
    temporaryHandle = await open(temporaryPath, "wx", 0o600);
    temporaryExists = true;
    await temporaryHandle.writeFile(contents);
    await temporaryHandle.close();
    temporaryHandle = undefined;
    const temporary = await lstat(temporaryPath);
    if (temporary.isSymbolicLink() || !temporary.isFile()) {
      throw new Error(`temporary overlay file is not a regular file: ${temporaryPath}`);
    }
    if (process.platform === "win32") {
      await assertSecureWindowsPath(temporaryPath, "atomic replacement temporary file", { scope: "private", targetType: "file" });
    }
    await rename(temporaryPath, filePath);
    temporaryExists = false;
    if (process.platform === "win32") {
      await assertSecureWindowsPath(filePath, "atomic replacement result", { scope: "private", targetType: "file" });
    }
  } finally {
    if (temporaryHandle) await temporaryHandle.close().catch(() => {});
    if (temporaryExists) await rm(temporaryPath, { force: true });
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function assertSourceGitCheckout(sourceRoot, overlay) {
  const head = run("git", ["rev-parse", "HEAD"], sourceRoot);
  const origin = run("git", ["remote", "get-url", "origin"], sourceRoot);
  const status = run("git", ["status", "--porcelain"], sourceRoot);
  if (head !== overlay.source.commit) throw new Error(`Prime Agent commit mismatch: expected ${overlay.source.commit}, found ${head}`);
  if (origin !== overlay.source.repository) throw new Error(`Prime Agent origin mismatch: expected ${overlay.source.repository}, found ${origin}`);
  if (status) throw new Error(`Prime Agent source checkout is modified; refusing to overlay it:\n${status}`);
}

function validateSourceCheckout(sourceRoot, overlay, packageJson, codingAgentPackage, packageJsonBytes, codingAgentPackageBytes, licenseBytes, lockBytes) {
  assertSourceGitCheckout(sourceRoot, overlay);
  if (packageJson.version !== overlay.source.version || packageJson.name !== "prime-agent") {
    throw new Error("Prime Agent root package identity does not match the reviewed overlay source");
  }
  if (codingAgentPackage.version !== overlay.source.version || codingAgentPackage.license !== overlay.source.license) {
    throw new Error("Prime Agent coding-agent version or license does not match the reviewed source pin");
  }
  if (sha256(packageJsonBytes) !== overlay.source.rootPackageJsonSha256
    || sha256(codingAgentPackageBytes) !== overlay.source.codingAgentPackageJsonSha256) {
    throw new Error("Prime Agent package manifest hashes do not match the reviewed source pin");
  }
  if (sha256(licenseBytes) !== overlay.source.licenseSha256 || !licenseBytes.toString("utf8").startsWith("MIT License")) {
    throw new Error("Prime Agent MIT license file hash or contents do not match the reviewed source pin");
  }
  if (sha256(lockBytes) !== overlay.source.packageLockSha256) {
    throw new Error("Prime Agent source package-lock.json hash does not match the reviewed baseline");
  }
}

export async function prepareDependencyOverlay(sourceRoot, destinationRoot, projectRoot = resolve(SCRIPT_DIR, "..")) {
  if (!sourceRoot || !destinationRoot) throw new Error("sourceRoot and destinationRoot are required");
  const { source, destination, destinationParent } = await resolveDisjointPaths(sourceRoot, destinationRoot);
  const root = await assertSecureProjectRoot(projectRoot);
  const manifestPath = await assertRegularFileNoSymlink(root, ["scripts", "dependency-hardening-overlay.json"], "overlay manifest");
  const lockPath = await assertRegularFileNoSymlink(root, ["scripts", "dependency-hardening", "prime-agent-package-lock.json"], "overlay lock");
  const overlay = await readJson(manifestPath);
  const overlayLockBytes = canonicalizeOverlayLockBytes(await readFile(lockPath), overlay.overlayLockSha256);
  assertSourceGitCheckout(source, overlay);
  const registryMetadataValidatedAt = await assertRegistryMetadataMatchesPins(overlay);
  const packageJsonPath = await assertRegularFileNoSymlink(source, ["package.json"], "Prime Agent root package.json");
  const codingAgentPackagePath = await assertRegularFileNoSymlink(source, ["packages", "coding-agent", "package.json"], "Prime Agent coding-agent package.json");
  const sourceLicensePath = await assertRegularFileNoSymlink(source, ["LICENSE"], "Prime Agent LICENSE");
  const sourceLockPath = await assertRegularFileNoSymlink(source, ["package-lock.json"], "Prime Agent package-lock.json");
  const packageJsonBytes = await readFile(packageJsonPath);
  const codingAgentPackageBytes = await readFile(codingAgentPackagePath);
  const sourcePackageJson = JSON.parse(packageJsonBytes.toString("utf8"));
  const codingAgentPackage = JSON.parse(codingAgentPackageBytes.toString("utf8"));
  const sourceLicense = await readFile(sourceLicensePath);
  const sourceLock = await readFile(sourceLockPath);
  validateSourceCheckout(source, overlay, sourcePackageJson, codingAgentPackage, packageJsonBytes, codingAgentPackageBytes, sourceLicense, sourceLock);

  const baseLock = JSON.parse(sourceLock.toString("utf8"));
  const overlayLock = JSON.parse(overlayLockBytes.toString("utf8"));
  assertOverrideConstraintsMatchLock(baseLock, overlay);
  assertResolvedLock(overlayLock, overlay);
  assertLockDeltaIsScoped(baseLock, overlayLock, overlay);
  if (overlayLock.packages?.[""]?.name !== sourcePackageJson.name
    || overlayLock.packages?.[""]?.version !== sourcePackageJson.version) {
    throw new Error("overlay lock root identity does not match pinned Prime Agent");
  }

  const amendedPackageJson = applyExactOverrides(sourcePackageJson, overlay);
  const encodedPackageJson = `${JSON.stringify(amendedPackageJson, null, "\t")}\n`;
  let reservation;
  let destinationCreated = false;
  try {
    await mkdir(destination, { mode: 0o700 });
    destinationCreated = true;
    reservation = await lstat(destination);
    if (reservation.isSymbolicLink() || !reservation.isDirectory()) {
      throw new Error("could not reserve an overlay destination directory");
    }
    await assertReservedDestination(destination, destinationParent, reservation);
    run("git", ["clone", "--no-hardlinks", "--no-checkout", source, destination], root);
    await assertReservedDestination(destination, destinationParent, reservation);
    run("git", ["remote", "set-url", "origin", overlay.source.repository], destination);
    run("git", ["checkout", "--detach", overlay.source.commit], destination);
    const overlayHead = run("git", ["rev-parse", "HEAD"], destination);
    if (overlayHead !== overlay.source.commit) throw new Error(`overlay clone commit mismatch: ${overlayHead}`);
    await assertReservedDestination(destination, destinationParent, reservation);
    await replaceRegularFileSafely(resolve(destination, "package.json"), encodedPackageJson);
    await replaceRegularFileSafely(resolve(destination, "package-lock.json"), overlayLockBytes);
    await assertReservedDestination(destination, destinationParent, reservation);
  } catch (error) {
    if (reservation) {
      await removeReservedDestination(destination, destinationParent, reservation);
    } else if (destinationCreated) {
      await removeUnreservedEmptyDestination(destination, destinationParent);
    }
    throw error;
  }

  return {
    path: destination,
    commit: overlay.source.commit,
    version: overlay.source.version,
    license: overlay.source.license,
    packageLockSha256: sha256(overlayLockBytes),
    registryMetadataValidatedAt,
    overrides: Object.fromEntries(Object.entries(overlay.overrides).map(([name, pin]) => [name, pin.version])),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [sourceRoot, destinationRoot] = process.argv.slice(2);
  if (!sourceRoot || !destinationRoot) {
    console.error("Usage: node scripts/prepare-dependency-overlay.mjs <clean-pinned-prime-agent-source> <new-overlay-checkout>");
    process.exitCode = 2;
  } else {
    prepareDependencyOverlay(sourceRoot, destinationRoot)
      .then((result) => console.log(JSON.stringify(result, null, 2)))
      .catch((error) => {
        console.error(`Dependency overlay preparation failed: ${error.message}`);
        process.exitCode = 1;
      });
  }
}
