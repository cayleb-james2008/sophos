import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { PRIME_AGENT_PIN } from "../scripts/runtime-pins.mjs";
import { matchesPrimeAgentSecurityBuildProvenance } from "../scripts/prepare-prime-agent-security-build.mjs";

function assertStagedDependencyClosure(nodeModules, entryManifests) {
  const stagedRoot = realpathSync(nodeModules);
  const checked = new Set();
  const pending = [];

  const isInsideStagedRoot = (path) => {
    const pathFromRoot = relative(stagedRoot, realpathSync(path));
    return pathFromRoot === "" || (!isAbsolute(pathFromRoot) && pathFromRoot !== ".." && !pathFromRoot.startsWith(`..${sep}`));
  };
  const resolvePackageDirectory = (start, name) => {
    const packageParts = name.split("/");
    let directory = start;
    while (true) {
      const candidate = join(directory, "node_modules", ...packageParts);
      if (existsSync(join(candidate, "package.json"))) return candidate;
      const parent = dirname(directory);
      if (parent === directory) return undefined;
      directory = parent;
    }
  };
  const addDependencies = (manifest, resolutionDirectory) => {
    const optional = new Set(Object.keys(manifest.optionalDependencies ?? {}));
    for (const name of Object.keys(manifest.dependencies ?? {})) {
      if (optional.has(name)) continue;
      pending.push({ name, owner: manifest.name ?? resolutionDirectory, resolutionDirectory });
    }
  };
  for (const { path, resolutionDirectory } of entryManifests) {
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
      throw new Error(`Lifecycle runtime dependency manifest is missing or invalid: ${path}`, { cause: error });
    }
    addDependencies(manifest, resolutionDirectory);
  }

  while (pending.length) {
    const { name, owner, resolutionDirectory } = pending.pop();
    const resolved = resolvePackageDirectory(resolutionDirectory, name);
    if (!resolved) throw new Error(`Staged runtime dependency ${name} declared by ${owner} is missing from resources/node_modules`);
    if (!isInsideStagedRoot(resolved)) {
      throw new Error(`Staged runtime dependency ${name} declared by ${owner} resolves outside resources/node_modules`);
    }
    const realPackageDir = realpathSync(resolved);
    if (checked.has(realPackageDir)) continue;
    checked.add(realPackageDir);
    const manifestPath = join(realPackageDir, "package.json");
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch (error) {
      throw new Error(`Staged runtime package has no valid manifest: ${realPackageDir}`, { cause: error });
    }
    addDependencies(manifest, realPackageDir);
  }
}

// bridge/node_modules is a compile-only tree. Run both participants below the
// staged resources/ root so Node's ESM resolver sees the full production tree.
// No inherited REF/BRIDGE overrides or source-tree fallback are permitted here.
export function resolveLifecycleRuntime(projectRoot) {
  const resources = join(projectRoot, "resources");
  const hint = "Stage the runtime first: node scripts/bundle.mjs (Windows x64) or node scripts/bundle.mjs --diagnostic (Linux/macOS).";
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(resources, ".bundle-manifest.json"), "utf8"));
  } catch (error) {
    throw new Error(`Lifecycle requires a complete staged bundle. ${hint}`, { cause: error });
  }
  if (!["repository", "ref", "commit", "version", "license"]
    .every((key) => manifest.upstream?.[key] === PRIME_AGENT_PIN[key])
    || !matchesPrimeAgentSecurityBuildProvenance(manifest.upstream?.overlay)) {
    throw new Error(`Lifecycle bundle does not declare the pinned Prime Agent source and reviewed overlay. ${hint}`);
  }
  const ref = join(resources, "daemon");
  const bridge = join(resources, "bridge", "dist", "bridge", "src", "index.js");
  const connection = join(resources, "bridge", "dist", "bridge", "src", "connection.js");
  const nodeModules = join(resources, "node_modules");
  for (const path of [join(ref, "dist", "cli.js"), bridge, connection, nodeModules]) {
    if (!existsSync(path)) throw new Error(`Lifecycle staged runtime is missing ${path}. ${hint}`);
  }
  assertStagedDependencyClosure(nodeModules, [
    { path: join(projectRoot, "bridge", "package.json"), resolutionDirectory: dirname(connection) },
    { path: join(ref, "package.json"), resolutionDirectory: join(ref, "dist", "bundle") },
  ]);
  return { ref, bridge, connection };
}
