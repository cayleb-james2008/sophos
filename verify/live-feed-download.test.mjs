import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  MAX_INSTALLER_BYTES,
  persistVerifiedInstaller,
  prepareVerifiedInstallerOutputs,
  readInstallerResponse,
  validateInstallerDownloadUrl,
  validateInstallerResponseUrl,
} from "./live-feed-download.mjs";

function tempDirectory(t) {
  const directory = mkdtempSync(join(tmpdir(), "sophos-live-feed-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test("accepts only the HTTPS versioned NSIS installer filename", () => {
  const result = validateInstallerDownloadUrl(
    "https://gitlab.com/api/v4/packages/Sophos_0.7.2_x64-setup.exe?download=1",
    "0.7.2",
  );
  assert.equal(result.filename, "Sophos_0.7.2_x64-setup.exe");
  assert.equal(result.safeUrl, "https://gitlab.com/api/v4/packages/Sophos_0.7.2_x64-setup.exe");
});

test("rejects insecure, credential-bearing, malformed, and mismatched installer URLs", () => {
  assert.throws(() => validateInstallerDownloadUrl("http://gitlab.com/Sophos_0.7.2_x64-setup.exe", "0.7.2"), /HTTPS/);
  assert.throws(() => validateInstallerDownloadUrl("https://user:pass@gitlab.com/Sophos_0.7.2_x64-setup.exe", "0.7.2"), /credentials/);
  assert.throws(() => validateInstallerDownloadUrl("https://gitlab.com/Sophos_0.7.2_x64-setup.msi", "0.7.2"), /filename/);
  assert.throws(() => validateInstallerDownloadUrl("https://gitlab.com/Sophos_0.7.2_x64-setup.exe", "latest"), /release version/);
  assert.throws(() => validateInstallerDownloadUrl("not a url", "0.7.2"), /invalid/);
});

test("requires HTTPS for the final redirected installer URL", () => {
  assert.doesNotThrow(() => validateInstallerResponseUrl("https://storage.example/Sophos_0.7.2_x64-setup.exe"));
  assert.throws(() => validateInstallerResponseUrl("http://storage.example/Sophos_0.7.2_x64-setup.exe"), /HTTPS/);
  assert.doesNotThrow(() => validateInstallerResponseUrl(""));
});

test("streams a non-empty installer only within the configured size bound", async () => {
  const bytes = await readInstallerResponse(new Response(Uint8Array.of(1, 2, 3)), 3);
  assert.deepEqual(bytes, Buffer.from([1, 2, 3]));
  assert.equal(MAX_INSTALLER_BYTES, 256 * 1024 * 1024);

  await assert.rejects(
    readInstallerResponse(new Response(Uint8Array.of(1, 2, 3, 4)), 3),
    /size limit/,
  );
  await assert.rejects(
    readInstallerResponse(new Response(Uint8Array.of(1), { headers: { "content-length": "4" } }), 3),
    /size limit/,
  );
  await assert.rejects(readInstallerResponse(new Response(new Uint8Array(0)), 3), /empty/);
});

test("removes stale outputs before a fresh check and rejects path collisions", (t) => {
  const directory = tempDirectory(t);
  const installerPath = join(directory, "installer.exe");
  const metadataPath = join(directory, "verified-installer.json");
  const reportPath = join(directory, "report.json");
  writeFileSync(installerPath, "stale installer");
  writeFileSync(metadataPath, "stale metadata");

  prepareVerifiedInstallerOutputs({ installerPath, metadataPath, reportPath });
  assert.equal(existsSync(installerPath), false);
  assert.equal(existsSync(metadataPath), false);
  assert.throws(
    () => prepareVerifiedInstallerOutputs({ installerPath, metadataPath: reportPath, reportPath }),
    /distinct paths/,
  );
  assert.throws(
    () => prepareVerifiedInstallerOutputs({ installerPath: "relative.exe", reportPath }),
    /absolute/,
  );
});

test("refuses failed signature/tamper checks and leaves no installable output", (t) => {
  const directory = tempDirectory(t);
  const installerPath = join(directory, "installer.exe");
  const metadataPath = join(directory, "verified-installer.json");
  prepareVerifiedInstallerOutputs({ installerPath, metadataPath });

  assert.throws(
    () => persistVerifiedInstaller({
      installerPath,
      metadataPath,
      bytes: Buffer.from("payload"),
      metadata: { signatureVerified: false, tamperingRejected: true },
    }),
    /signature and tamper checks/,
  );
  assert.equal(existsSync(installerPath), false);
  assert.equal(existsSync(metadataPath), false);
});

test("writes only verified installer bytes and metadata, and rolls back partial output", (t) => {
  const directory = tempDirectory(t);
  const installerPath = join(directory, "nested", "installer.exe");
  const metadataPath = join(directory, "nested", "verified-installer.json");
  const bytes = Buffer.from("verified public installer");
  const metadata = { signatureVerified: true, tamperingRejected: true, sha256: "example" };

  persistVerifiedInstaller({ installerPath, metadataPath, bytes, metadata });
  assert.deepEqual(readFileSync(installerPath), bytes);
  assert.deepEqual(JSON.parse(readFileSync(metadataPath, "utf8")), metadata);

  const blockedParent = join(directory, "regular-file");
  writeFileSync(blockedParent, "not a directory");
  const failedInstallerPath = join(directory, "failed", "installer.exe");
  const failedMetadataPath = join(blockedParent, "metadata.json");
  assert.throws(
    () => persistVerifiedInstaller({ installerPath: failedInstallerPath, metadataPath: failedMetadataPath, bytes, metadata }),
  );
  assert.equal(existsSync(failedInstallerPath), false);
});
