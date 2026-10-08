import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PRIME_AGENT_PIN } from "../scripts/runtime-pins.mjs";
import { matchesPrimeAgentSecurityBuildProvenance } from "../scripts/prepare-prime-agent-security-build.mjs";

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
  for (const path of [join(ref, "dist", "cli.js"), bridge, connection, join(resources, "node_modules")]) {
    if (!existsSync(path)) throw new Error(`Lifecycle staged runtime is missing ${path}. ${hint}`);
  }
  return { ref, bridge, connection };
}
