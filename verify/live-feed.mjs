#!/usr/bin/env node
// verify/live-feed.mjs — LIVE update-feed integrity check (v0.7.2).
//
// Verifies the published auto-updater feed exactly as the app's updater
// would consume it, against the LIVE endpoint configured in tauri.conf.json:
//   1. fetch the manifest from the app's configured endpoint,
//   2. validate the manifest shape (version / notes / pub_date / platform),
//   3. download the announced installer,
//   4. cryptographically verify the manifest signature over the downloaded
//      bytes with the pubkey from tauri.conf.json — the updater's exact
//      check (minisign Ed25519 over Blake2b-512 prehash),
//   5. negative test: a tampered binary must be rejected.
//
// This is the permanent form of the one-off check used when publishing a
// release. It complements verify/updater-test.mjs (local config + dummy
// feed) and verify/updater-live.mjs (installed-app apply flow). Wired into
// CI as a blocking check: a broken feed means the app's auto-updater is
// broken for every user, so a failure must red the build.
//
// Run:  node verify/live-feed.mjs   (or `npm run test:live-feed`)

import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { createHash, createPublicKey, verify } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..");
const REPORT_PATH = join(__dirname, "live-feed-report.json");
const MANIFEST_TIMEOUT_MS = 20_000;
const INSTALLER_TIMEOUT_MS = 120_000; // a ~100 MB installer download is slow

const results = [];
function check(name, cond, detail = "") {
  results.push({ name, status: !!cond, detail });
  console.log(`${cond ? "✅" : "❌"} ${name}${detail ? " — " + detail : ""}`);
}

function has(detail) {
  return detail ? ` — ${detail}` : "";
}

async function main() {
  console.log("=== Sophos Live Update-Feed Integrity Check ===\n");

  // The exact endpoint + pubkey the app is configured with.
  const tauriConf = JSON.parse(readFileSync(join(REPO, "src-tauri", "tauri.conf.json"), "utf-8"));
  const updaterConf = tauriConf?.plugins?.updater;
  const endpoint = updaterConf?.endpoints?.[0];
  const pubkey = updaterConf?.pubkey;

  check("app config has an updater endpoint", typeof endpoint === "string" && endpoint.length > 0, has(endpoint));
  check("app config has a pubkey", typeof pubkey === "string" && pubkey.length > 0, has(`len=${pubkey?.length}`));
  if (!endpoint || !pubkey) {
    return finish(1);
  }

  let manifest;
  try {
    const resp = await fetch(endpoint, { signal: AbortSignal.timeout(MANIFEST_TIMEOUT_MS) });
    check("feed endpoint is reachable", resp.ok, `status=${resp.status}`);
    if (resp.ok) {
      manifest = await resp.json();
      check("manifest parses as JSON", !!manifest && typeof manifest === "object");
    }
  } catch (e) {
    check("feed endpoint is reachable", false, e.message);
    return finish(1);
  }

  if (!manifest) return finish(1);

  check("manifest has a version", typeof manifest.version === "string" && manifest.version.length > 0, has(`version=${manifest.version}`));
  check("manifest has release notes", typeof manifest.notes === "string");
  check("manifest has a publish date", typeof manifest.pub_date === "string", has(manifest.pub_date));

  const entry = manifest.platforms?.["windows-x86_64"];
  check("manifest has a windows-x86_64 platform entry", !!entry);
  if (!entry) return finish(1);

  const { url, signature } = entry;
  check("platform entry has a download url", typeof url === "string" && url.startsWith("https"), has(url));
  check("platform entry has a signature", typeof signature === "string" && signature.length > 0, has(`len=${signature?.length}`));
  if (!url || !signature) return finish(1);

  // Download the announced installer.
  let bytes;
  try {
    const dl = await fetch(url, { signal: AbortSignal.timeout(INSTALLER_TIMEOUT_MS) });
    check("installer downloads from the manifest url", dl.ok, `status=${dl.status}`);
    if (!dl.ok) return finish(1);
    try {
      bytes = Buffer.from(await dl.arrayBuffer());
      check("downloaded installer has content", bytes.length > 0, `${(bytes.length / 1e6).toFixed(1)} MB`);
    } catch (e) {
      check("downloaded installer has content", false, e.message);
      return finish(1);
    }
  } catch (e) {
    check("installer downloads from the manifest url", false, e.message);
    return finish(1);
  }

  // The updater's exact verification path: minisign Ed25519 over
  // Blake2b-512 prehash, key id must match the configured pubkey.
  try {
    const pubDecoded = Buffer.from(pubkey, "base64").toString("utf-8").split("\n").filter((l) => l.trim());
    const sigDecoded = Buffer.from(signature, "base64").toString("utf-8").split("\n").filter((l) => l.trim());
    check("pubkey decodes (comment + key lines)", pubDecoded.length >= 2);
    check("signature decodes (comment + sig lines)", sigDecoded.length >= 2);

    const pubRaw = Buffer.from(pubDecoded[1].trim(), "base64");
    const sigRaw = Buffer.from(sigDecoded[1].trim(), "base64");
    const hasFlags = sigRaw.length === 76;
    check("pubkey is 42 bytes (Ed + keyId + key)", pubRaw.length === 42, has(`len=${pubRaw.length}`));
    check("signature is 74/76 bytes (minisign Ed25519)", sigRaw.length === 74 || sigRaw.length === 76, has(`len=${sigRaw.length}`));

    const pubKeyId = pubRaw.subarray(2, 10);
    const pubKeyBytes = pubRaw.subarray(10, 42);
    const sigKeyId = hasFlags ? sigRaw.subarray(4, 12) : sigRaw.subarray(2, 10);
    const sigBytes = hasFlags ? sigRaw.subarray(12, 76) : sigRaw.subarray(10, 74);
    const flags = hasFlags ? sigRaw.readUInt16LE(2) : 0x01;
    check("key id matches between pubkey and signature", pubKeyId.equals(sigKeyId));
    check("signature uses the blake2b prehash flag", (flags & 0x01) !== 0, has(`flags=0x${flags.toString(16)}`));

    const prehash = createHash("blake2b512").update(bytes).digest();
    const spki = Buffer.concat([
      Buffer.from([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00]),
      pubKeyBytes,
    ]);
    const key = createPublicKey({ key: spki, format: "der", type: "spki" });
    const valid = verify(null, prehash, key, sigBytes);
    check("Ed25519 signature verifies over the downloaded installer", valid, valid ? "cryptographically valid ✓" : "INVALID");

    // Negative test: one flipped byte must fail verification.
    const tampered = Buffer.concat([bytes.subarray(0, -1), Buffer.from([bytes[bytes.length - 1] ^ 0xff])]);
    const tamperedHash = createHash("blake2b512").update(tampered).digest();
    check("tampered binary is correctly REJECTED", !verify(null, tamperedHash, key, sigBytes));
  } catch (e) {
    check("cryptographic signature verification", false, e.message);
  }

  // Informational (never fails): cross-check the served bytes against a
  // local installer for the same announced version, if one exists on disk.
  const localInstaller = join(
    REPO,
    "src-tauri",
    "target",
    "release",
    "bundle",
    "nsis",
    `Sophos_${manifest.version}_x64-setup.exe`,
  );
  if (existsSync(localInstaller)) {
    const localSha = createHash("sha256").update(readFileSync(localInstaller)).digest("hex");
    const remoteSha = createHash("sha256").update(bytes).digest("hex");
    const match = localSha === remoteSha;
    console.log(
      `${match ? "ℹ️" : "⚠️"} local build ${manifest.version} ${match ? "matches" : "DIFFERS from"} the served installer (sha256 ${remoteSha.slice(0, 16)}…)`,
    );
    results.push({ name: `local ${manifest.version} build matches the served installer`, status: "info", detail: match ? "match" : "differs (stale local build)" });
  } else {
    console.log(`ℹ️ no local ${manifest.version} installer on disk — skipping the local byte comparison`);
    results.push({ name: "local byte comparison", status: "info", detail: "no local installer" });
  }

  finish(results.some((r) => r.status === false) ? 1 : 0);
}

function finish(exitCode) {
  const passed = results.filter((r) => r.status === true).length;
  const failed = results.filter((r) => r.status === false).length;
  const info = results.filter((r) => r.status === "info").length;
  const report = {
    suite: "sophos-live-feed",
    startedAt: new Date().toISOString(),
    results,
    summary: { total: results.length, passed, failed, info, overall: exitCode === 0 ? "PASS" : "FAIL" },
  };
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(`\n=== Result: ${exitCode === 0 ? "PASS" : "FAIL"} (${passed} passed, ${failed} failed${info ? `, ${info} informational` : ""}) ===`);
  console.log(`Report: ${REPORT_PATH}`);
  process.exit(exitCode);
}

main().catch((e) => {
  console.error("live-feed check failed with error:", e.message);
  process.exit(1);
});
