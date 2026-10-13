import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";
import { verifyExtractedLicense } from "./tauri-package-license.mjs";

const executableName = "prime-agent-windows.exe";
const expectedLicense = Buffer.from("MIT License\nupstream notice\n", "utf8");

async function withExtractedMsiLayout(run) {
  const extractionRoot = await mkdtemp(join(tmpdir(), "sophos-msi-layout-"));
  const installDir = join(extractionRoot, "Program Files", "Sophos");
  try {
    await mkdir(installDir, { recursive: true });
    await writeFile(join(installDir, executableName), "test executable");
    await run({ extractionRoot, installDir });
  } finally {
    await rm(extractionRoot, { recursive: true, force: true });
  }
}

test("verifies Tauri's daemon/LICENSE mapping beside the MSI-installed executable", async () => {
  await withExtractedMsiLayout(async ({ extractionRoot, installDir }) => {
    await mkdir(join(installDir, "daemon"), { recursive: true });
    await writeFile(join(installDir, "daemon", "LICENSE"), expectedLicense);

    const result = await verifyExtractedLicense(extractionRoot, executableName, expectedLicense);

    assert.deepEqual(result, {
      relativePath: relative(extractionRoot, join(installDir, "daemon", "LICENSE")),
      bytes: expectedLicense.length,
    });
  });
});

test("rejects a notice misplaced under resources/daemon instead of the mapped install path", async () => {
  await withExtractedMsiLayout(async ({ installDir, extractionRoot }) => {
    await mkdir(join(installDir, "resources", "daemon"), { recursive: true });
    await writeFile(join(installDir, "resources", "daemon", "LICENSE"), expectedLicense);

    await assert.rejects(
      verifyExtractedLicense(extractionRoot, executableName, expectedLicense),
      /daemon[\\/]LICENSE beside prime-agent-windows\.exe/,
    );
  });
});

test("rejects a mapped MSI notice that differs from the staged upstream bytes", async () => {
  await withExtractedMsiLayout(async ({ installDir, extractionRoot }) => {
    await mkdir(join(installDir, "daemon"), { recursive: true });
    await writeFile(join(installDir, "daemon", "LICENSE"), Buffer.from("MIT License\nmodified\n", "utf8"));

    await assert.rejects(
      verifyExtractedLicense(extractionRoot, executableName, expectedLicense),
      /byte-for-byte/,
    );
  });
});
