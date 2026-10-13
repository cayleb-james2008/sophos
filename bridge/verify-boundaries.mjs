import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveLifecycleRuntime } from "./lifecycle-runtime.mjs";
import { selectE2ENode } from "../verify/runtime-executable.mjs";
import { validateNodeExecutable } from "../scripts/node-runtime.mjs";
import { NODE_RUNTIME_PIN } from "../scripts/runtime-pins.mjs";

const bridgeDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(bridgeDir, "..");
const runtime = resolveLifecycleRuntime(projectRoot);
const bundledNode = join(
  projectRoot,
  "resources",
  "node",
  `node-v${NODE_RUNTIME_PIN.version}-${NODE_RUNTIME_PIN.platform}`,
  "node.exe",
);
const node = selectE2ENode(process.platform, process.execPath, bundledNode);
if (process.platform === "win32") await validateNodeExecutable(bundledNode);
const stagedBridgeDir = join(projectRoot, "resources", "bridge");
const testPath = join(stagedBridgeDir, `connection-boundaries-${process.pid}.test.mjs`);
const isolatedHome = mkdtempSync(join(tmpdir(), "sophos-boundaries-runner-"));
const inheritedEnvironment = Object.fromEntries(
  [
    "PATH",
    "SystemRoot",
    "WINDIR",
    "COMSPEC",
    "PATHEXT",
    "SystemDrive",
    "LANG",
    "LC_ALL",
    "TZ",
    "TMPDIR",
    "TEMP",
    "TMP",
  ]
    .filter((name) => process.env[name] !== undefined)
    .map((name) => [name, process.env[name]]),
);

try {
  copyFileSync(join(bridgeDir, "connection-boundaries.test.mjs"), testPath);
  const result = spawnSync(node, ["--test", testPath], {
    cwd: stagedBridgeDir,
    encoding: "utf8",
    timeout: 60_000,
    env: {
      ...inheritedEnvironment,
      HOME: isolatedHome,
      USERPROFILE: isolatedHome,
      APPDATA: join(isolatedHome, "AppData", "Roaming"),
      LOCALAPPDATA: join(isolatedHome, "AppData", "Local"),
      PI_OFFLINE: "1",
    },
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`staged bridge boundary tests exited with code ${result.status ?? "unknown"}`);
  }
  console.log(`boundary tests loaded staged connection ${runtime.connection}`);
} finally {
  rmSync(testPath, { force: true });
  rmSync(isolatedHome, { recursive: true, force: true });
}
