import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { PRIME_AGENT_PIN } from "../scripts/runtime-pins.mjs";
import { matchesPrimeAgentSecurityBuildProvenance } from "../scripts/prepare-prime-agent-security-build.mjs";

function assertStagedDependencyClosure(nodeModules) {
  const stagedRoot = realpathSync(nodeModules);
  const checked = new Set();
  const packageDirs = [];
  const discover = (directory) => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === ".bin") continue;
      const child = join(directory, entry.name);
      if (entry.name.startsWith("@")) {
        discover(child);
        continue;
      }
      if (existsSync(join(child, "package.json"))) {
        packageDirs.push(child);
        discover(join(child, "node_modules"));
      }
    }
  };
  discover(nodeModules);

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
  while (packageDirs.length) {
    const packageDir = packageDirs.pop();
    if (checked.has(packageDir)) continue;
    checked.add(packageDir);
    const manifestPath = join(packageDir, "package.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    for (const name of Object.keys(manifest.dependencies ?? {})) {
      const resolved = resolvePackageDirectory(packageDir, name);
      if (!resolved) throw new Error(`Staged runtime dependency ${name} declared by ${manifest.name ?? packageDir} is missing from resources/node_modules`);
      if (!isInsideStagedRoot(resolved)) {
        throw new Error(`Staged runtime dependency ${name} declared by ${manifest.name ?? packageDir} resolves outside resources/node_modules`);
      }
    }
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
  assertStagedDependencyClosure(nodeModules);
  return { ref, bridge, connection };
}
