import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertWindowsReleaseProvenance } from "./native-runtime-platform.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const manifestPath = resolve(root, "resources", ".bundle-manifest.json");
const tauriCli = resolve(root, "node_modules", "@tauri-apps", "cli", "tauri.js");

async function main() {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assertWindowsReleaseProvenance(manifest);

  const result = spawnSync(process.execPath, [tauriCli, "build", "--bundles", "msi"], {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
    timeout: 30 * 60 * 1000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`guarded Tauri MSI build failed (exit ${result.status})`);
}

main().catch((error) => {
  console.error(`Windows release build refused or failed: ${error.message}`);
  process.exitCode = 1;
});
