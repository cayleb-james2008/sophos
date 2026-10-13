import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";

async function findInstalledExecutable(extractionRoot, executableName) {
  const matches = [];
  const expectedName = executableName.toLowerCase();
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
      } else if (entry.isFile() && entry.name.toLowerCase() === expectedName) {
        matches.push(path);
      }
    }
  }
  await walk(extractionRoot);
  assert.equal(
    matches.length,
    1,
    `MSI must contain exactly one ${basename(executableName)} after extraction; found ${matches.length}`,
  );
  return matches[0];
}

export async function verifyExtractedLicense(extractionRoot, executableName, expectedLicense) {
  const executablePath = await findInstalledExecutable(extractionRoot, executableName);
  const appInstallDir = dirname(executablePath);
  const packagedLicense = join(appInstallDir, "daemon", "LICENSE");
  let actualLicense;
  try {
    actualLicense = await readFile(packagedLicense);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`MSI must contain daemon/LICENSE beside ${basename(executablePath)} after extraction`);
    }
    throw error;
  }
  assert.deepEqual(actualLicense, expectedLicense, "MSI daemon/LICENSE must match the staged upstream MIT notice byte-for-byte");
  return { relativePath: relative(extractionRoot, packagedLicense), bytes: expectedLicense.length };
}
