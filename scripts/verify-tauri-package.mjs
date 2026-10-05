import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertWindowsReleaseProvenance } from "./native-runtime-platform.mjs";
import { verifyExtractedLicense } from "./tauri-package-license.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(root, "resources", ".bundle-manifest.json");
const bundleDir = join(root, "src-tauri", "target", "release", "bundle", "msi");
const stagedLicense = join(root, "resources", "daemon", "LICENSE");
const appExecutable = join(root, "src-tauri", "target", "release", "prime-agent-windows.exe");

async function findMsiFiles(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await findMsiFiles(path));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".msi")) found.push(path);
  }
  return found;
}

async function verifyMsiContainsLicense(msiPath, expectedLicense) {
  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;
  if (!systemRoot) throw new Error("SystemRoot/WINDIR is required for MSI extraction");
  const extractionRoot = await mkdtemp(join(tmpdir(), "sophos-msi-license-"));
  const logPath = join(extractionRoot, "msiexec.log");
  const env = {
    SystemRoot: systemRoot,
    WINDIR: systemRoot,
    PATH: join(systemRoot, "System32"),
    TEMP: extractionRoot,
    TMP: extractionRoot,
    HOME: extractionRoot,
    USERPROFILE: extractionRoot,
  };
  try {
    const result = spawnSync(join(systemRoot, "System32", "msiexec.exe"), [
      "/a", msiPath, "/qn", "/norestart", "/L*v", logPath, `TARGETDIR=${extractionRoot}`,
    ], { encoding: "utf8", env, windowsHide: true, timeout: 120_000 });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`administrative MSI extraction failed: ${result.stderr || result.stdout}`);

    const packaged = await verifyExtractedLicense(extractionRoot, basename(appExecutable), expectedLicense);
    return packaged;
  } finally {
    await rm(extractionRoot, { recursive: true, force: true });
  }
}

async function main() {
  if (process.platform !== "win32" || process.arch !== "x64") {
    throw new Error(`MSI inclusion check requires a real Windows x64 host; got ${process.platform}/${process.arch}`);
  }
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assertWindowsReleaseProvenance(manifest);
  const expectedLicense = await readFile(stagedLicense);
  const msis = await findMsiFiles(bundleDir);
  assert.ok(msis.length > 0, `no MSI installer found under ${bundleDir}; run the guarded Windows release build first`);

  for (const msi of msis) {
    const packaged = await verifyMsiContainsLicense(msi, expectedLicense);
    console.log(`verified ${msi} contains daemon/LICENSE beside the MSI-installed executable byte-for-byte (${packaged.bytes} bytes at ${packaged.relativePath})`);
  }
}

main().catch((error) => {
  console.error(`Tauri MSI resource verification failed: ${error.message}`);
  process.exitCode = 1;
});
