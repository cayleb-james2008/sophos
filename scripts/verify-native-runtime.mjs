import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertWindowsReleaseProvenance } from "./native-runtime-platform.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const resources = resolve(root, "resources");
const manifestPath = resolve(resources, ".bundle-manifest.json");
const bundledNode = resolve(resources, "node", "node-v24.18.0-win-x64", "node.exe");
const smoke = String.raw`
if (process.platform !== "win32" || process.arch !== "x64") {
  throw new Error("native smoke requires the real bundled win32/x64 Node process");
}
const zmq = require("zeromq");
const socket = new zmq.Dealer();
socket.close();
const koffi = require("koffi");
if (koffi.sizeof("int") !== 4) throw new Error("Koffi native sizeof operation failed");
const clipboardNative = require("@mariozechner/clipboard-win32-x64-msvc");
if (typeof clipboardNative.getText !== "function") throw new Error("Windows x64 clipboard addon did not load");
const clipboard = require("@mariozechner/clipboard");
if (clipboard.getText !== clipboardNative.getText) throw new Error("clipboard wrapper did not select its Windows native addon");
console.log(JSON.stringify({
  platform: process.platform,
  arch: process.arch,
  node: process.version,
  loadedNativeModules: ["zeromq", "koffi", "@mariozechner/clipboard"]
}));
`;

async function main() {
  if (process.platform !== "win32" || process.arch !== "x64") {
    throw new Error(`native addon smoke is Windows x64-only; got ${process.platform}/${process.arch}`);
  }
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assertWindowsReleaseProvenance(manifest);

  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;
  if (!systemRoot) throw new Error("SystemRoot/WINDIR is required to load Windows native modules");
  const isolatedTemp = tmpdir();
  const env = {
    SystemRoot: systemRoot,
    WINDIR: systemRoot,
    PATH: join(systemRoot, "System32"),
    TEMP: isolatedTemp,
    TMP: isolatedTemp,
    HOME: isolatedTemp,
    USERPROFILE: isolatedTemp,
  };
  const result = spawnSync(bundledNode, ["-e", smoke], {
    cwd: resources,
    env,
    encoding: "utf8",
    windowsHide: true,
    timeout: 60_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`bundled Node native addon load failed (exit ${result.status})\n${result.stdout}\n${result.stderr}`);
  }
  process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

main().catch((error) => {
  console.error(`Windows native dependency smoke failed: ${error.message}`);
  process.exitCode = 1;
});
