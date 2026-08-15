#!/usr/bin/env node
// verify/updater-test.mjs
// Integration test for the Sophos Tauri v2 auto-updater.
// Verifies that:
//   1. The updater plugin is configured in tauri.conf.json (pubkey, endpoint)
//   2. The updater permissions are in capabilities/default.json
//   3. The plugin is registered in lib.rs
//   4. A signed update binary has a valid signature against the public key
//   5. The update feed server serves a valid manifest with the correct fields
//   6. The manifest's signature matches the signed binary
//
// Usage: node verify/updater-test.mjs

import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync, spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..");
const SCRIPTS = join(REPO, "scripts");
const SRC_TAURI = join(REPO, "src-tauri");

const REPORT_PATH = join(__dirname, "updater-report.json");
const PASS = "✅ PASS";
const FAIL = "❌ FAIL";
const results = [];

function check(name, cond, detail = "") {
  const status = cond ? PASS : FAIL;
  results.push({ name, status: cond, detail });
  console.log(`${status} — ${name}${detail ? `: ${detail}` : ""}`);
  return cond;
}

async function main() {
  console.log("=== Sophos Auto-Updater Integration Test ===\n");
  let allPass = true;

  // 1. Verify tauri.conf.json has updater config
  console.log("→ Checking tauri.conf.json updater config...");
  const tauriConf = JSON.parse(readFileSync(join(SRC_TAURI, "tauri.conf.json"), "utf-8"));
  const updaterConf = tauriConf?.plugins?.updater;
  check(
    "tauri.conf.json has plugins.updater",
    !!updaterConf,
    updaterConf ? "found" : "missing",
  ) || (allPass = false);

  check(
    "updater.active is true",
    updaterConf?.active === true,
    `active=${updaterConf?.active}`,
  ) || (allPass = false);

  check(
    "updater has endpoints array",
    Array.isArray(updaterConf?.endpoints) && updaterConf.endpoints.length > 0,
    `endpoints=${JSON.stringify(updaterConf?.endpoints)}`,
  ) || (allPass = false);

  check(
    "updater has pubkey",
    typeof updaterConf?.pubkey === "string" && updaterConf.pubkey.length > 0,
    `pubkey length=${updaterConf?.pubkey?.length}`,
  ) || (allPass = false);

  check(
    "version is present in tauri.conf.json",
    typeof tauriConf?.version === "string" && tauriConf.version.length > 0,
    `version=${tauriConf?.version}`,
  ) || (allPass = false);

  // 2. Verify capabilities/default.json has updater permissions
  console.log("\n→ Checking capabilities...");
  const capabilities = JSON.parse(readFileSync(join(SRC_TAURI, "capabilities", "default.json"), "utf-8"));
  const hasUpdaterPerm = capabilities?.permissions?.some(
    (p) => p === "updater:default" || p.startsWith("updater:"),
  );
  check(
    "capabilities include updater permission",
    hasUpdaterPerm,
    `permissions=${JSON.stringify(capabilities?.permissions)}`,
  ) || (allPass = false);

  // 3. Verify lib.rs registers the updater plugin
  console.log("\n→ Checking lib.rs plugin registration...");
  const libRs = readFileSync(join(SRC_TAURI, "src", "lib.rs"), "utf-8");
  check(
    "lib.rs registers tauri_plugin_updater",
    libRs.includes("tauri_plugin_updater"),
    libRs.includes("tauri_plugin_updater") ? "found" : "missing",
  ) || (allPass = false);

  // 4. Verify Cargo.toml has the updater dependency
  console.log("\n→ Checking Cargo.toml...");
  const cargoToml = readFileSync(join(SRC_TAURI, "Cargo.toml"), "utf-8");
  check(
    "Cargo.toml has tauri-plugin-updater dependency",
    cargoToml.includes("tauri-plugin-updater"),
    "found",
  ) || (allPass = false);

  // 5. Verify signing key pair exists
  console.log("\n→ Checking signing keys...");
  const keyPath = join(SCRIPTS, "updater.key");
  const pubPath = join(SCRIPTS, "updater.key.pub");
  check(
    "Private key exists (scripts/updater.key)",
    existsSync(keyPath),
    existsSync(keyPath) ? "found" : "missing — run gen-updater-keys.mjs",
  ) || (allPass = false);

  check(
    "Public key exists (scripts/updater.key.pub)",
    existsSync(pubPath),
    existsSync(pubPath) ? "found" : "missing — run gen-updater-keys.mjs",
  ) || (allPass = false);

  // Verify the pubkey in tauri.conf.json matches the .key.pub file
  if (existsSync(pubPath) && updaterConf?.pubkey) {
    const pubFileContent = readFileSync(pubPath, "utf-8").trim();
    check(
      "tauri.conf.json pubkey matches .key.pub file",
      updaterConf.pubkey === pubFileContent,
      `match=${updaterConf.pubkey === pubFileContent}`,
    ) || (allPass = false);
  }

  // 6. Build a signed update and verify the signature
  console.log("\n→ Building and signing a test update...");
  try {
    execSync("node scripts/build-signed-update.mjs --version 0.2.0", {
      stdio: "pipe",
      cwd: REPO,
      env: { ...process.env, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "" },
    });
    check("build-signed-update.mjs ran successfully", true);
  } catch (e) {
    check("build-signed-update.mjs ran successfully", false, e.message);
    allPass = false;
  }

  // Verify the signature file was created
  const sigPath = join(SCRIPTS, "update.sig");
  const updatePath = join(SCRIPTS, "update-binary.bin");
  check(
    "Signature file exists (scripts/update.sig)",
    existsSync(sigPath),
    existsSync(sigPath) ? "found" : "missing",
  ) || (allPass = false);

  check(
    "Update binary exists (scripts/update-binary.bin)",
    existsSync(updatePath),
    existsSync(updatePath) ? "found" : "missing",
  ) || (allPass = false);

  // 7. Start the update feed server and verify the manifest
  console.log("\n→ Testing update feed server...");
  let serverProc = null;
  let manifestValid = false;
  let manifestFieldsOk = false;
  let signatureInManifest = false;

  try {
    serverProc = spawn("node", ["scripts/serve-update-feed.mjs", "--port", "37822", "--version", "0.2.0"], {
      stdio: "ignore",
      cwd: REPO,
      windowsHide: true,
    });

    // Wait for server to start
    await sleep(1500);

    // Fetch the manifest
    const response = await fetch("http://127.0.0.1:37822/manifest.json");
    check(
      "Update feed server responds on /manifest.json",
      response.ok,
      `status=${response.status}`,
    ) || (allPass = false);

    if (response.ok) {
      const manifest = await response.json();
      manifestValid = true;

      // Verify manifest fields
      const hasVersion = typeof manifest.version === "string" && manifest.version.length > 0;
      const hasNotes = typeof manifest.notes === "string";
      const hasPubDate = typeof manifest.pub_date === "string";
      const hasPlatforms = manifest.platforms && manifest.platforms["windows-x86_64"];
      const hasUrl = hasPlatforms && typeof manifest.platforms["windows-x86_64"].url === "string";
      const hasSig = hasPlatforms && typeof manifest.platforms["windows-x86_64"].signature === "string";

      check(
        "Manifest has version field",
        hasVersion,
        `version=${manifest.version}`,
      ) || (allPass = false);

      check(
        "Manifest has notes field",
        hasNotes,
      ) || (allPass = false);

      check(
        "Manifest has pub_date field",
        hasPubDate,
        `pub_date=${manifest.pub_date}`,
      ) || (allPass = false);

      check(
        "Manifest has platforms.windows-x86_64",
        hasPlatforms,
      ) || (allPass = false);

      check(
        "Manifest platform has url",
        hasUrl,
        `url=${manifest.platforms?.["windows-x86_64"]?.url}`,
      ) || (allPass = false);

      check(
        "Manifest platform has signature",
        hasSig,
        `signature length=${manifest.platforms?.["windows-x86_64"]?.signature?.length}`,
      ) || (allPass = false);

      if (hasSig && existsSync(sigPath)) {
        const sigContent = readFileSync(sigPath, "utf-8").trim();
        const manifestSig = manifest.platforms["windows-x86_64"].signature;
        check(
          "Manifest signature matches update.sig file",
          sigContent === manifestSig,
          `match=${sigContent === manifestSig}`,
        ) || (allPass = false);
        signatureInManifest = true;
      }

      // 8. Verify the update binary can be downloaded
      console.log("\n→ Testing update binary download...");
      const updateResp = await fetch("http://127.0.0.1:37822/update");
      check(
        "Update binary downloads successfully",
        updateResp.ok,
        `status=${updateResp.status}`,
      ) || (allPass = false);

      if (updateResp.ok) {
        const updateData = Buffer.from(await updateResp.arrayBuffer());
        check(
          "Update binary has content",
          updateData.length > 0,
          `size=${updateData.length} bytes`,
        ) || (allPass = false);
      }
    }
  } catch (e) {
    check("Update feed server test", false, e.message);
    allPass = false;
  } finally {
    // Kill the server
    if (serverProc) {
      try {
        if (process.platform === "win32") {
          execSync(`taskkill /F /T /PID ${serverProc.pid}`, { stdio: "ignore" });
        } else {
          serverProc.kill("SIGTERM");
        }
      } catch {}
    }
  }

  // 9. Cryptographically verify the signature against the public key.
  // The Tauri updater uses minisign format with Ed25519 over Blake2b-512
  // prehash. We reproduce the exact verification path the updater plugin
  // (minisign-verify) follows: parse the minisign public key + signature,
  // match key IDs, compute blake2b-512 of the update binary, and verify
  // the Ed25519 signature over the prehash using Node.js crypto.
  console.log("\n→ Cryptographically verifying signature...");
  if (existsSync(sigPath) && existsSync(pubPath) && existsSync(updatePath)) {
    const sigContent = readFileSync(sigPath, "utf-8").trim();
    const pubContent = readFileSync(pubPath, "utf-8").trim();
    const updateData = readFileSync(updatePath);

    // Both files are base64-encoded; decoding gives the minisign text format
    // (comment line + key/sig line separated by newlines).
    const sigDecoded = Buffer.from(sigContent, "base64").toString("utf-8");
    const pubDecoded = Buffer.from(pubContent, "base64").toString("utf-8");

    const sigLines = sigDecoded.split("\n").filter((l) => l.trim());
    const pubLines = pubDecoded.split("\n").filter((l) => l.trim());

    check("Signature file has comment + signature lines", sigLines.length >= 2, `lines=${sigLines.length}`) || (allPass = false);
    check("Public key file has comment + key lines", pubLines.length >= 2, `lines=${pubLines.length}`) || (allPass = false);

    if (sigLines.length >= 2 && pubLines.length >= 2) {
      try {
        // Parse the minisign public key line (base64 of: Ed[2] + keyId[8] + pubKey[32] = 42 bytes)
        const pubRaw = Buffer.from(pubLines[1].trim(), "base64");
        check("Public key raw data is 42 bytes", pubRaw.length === 42, `length=${pubRaw.length}`) || (allPass = false);

        // Parse the minisign signature line.
        // Standard minisign: Ed[2] + flags[2] + keyId[8] + sig[64] = 76 bytes.
        // Tauri's signer may omit flags: Ed[2] + keyId[8] + sig[64] = 74 bytes.
        const sigRaw = Buffer.from(sigLines[1].trim(), "base64");
        const sigLen = sigRaw.length;
        const hasFlags = sigLen === 76;
        check(`Signature raw data is ${hasFlags ? 76 : 74} bytes`, sigLen === 74 || sigLen === 76, `length=${sigLen}`) || (allPass = false);

        if (pubRaw.length === 42 && (sigLen === 74 || sigLen === 76)) {
          // Extract components
          const pubMagic = pubRaw.subarray(0, 2).toString("ascii");  // "Ed"
          const pubKeyId = pubRaw.subarray(2, 10);                     // 8 bytes
          const pubKeyBytes = pubRaw.subarray(10, 42);                 // 32 bytes raw Ed25519 public key

          const sigMagic = sigRaw.subarray(0, 2).toString("ascii");  // "Ed"
          let sigFlags, sigKeyId, sigBytes;
          if (hasFlags) {
            sigFlags = sigRaw.readUInt16LE(2);
            sigKeyId = sigRaw.subarray(4, 12);
            sigBytes = sigRaw.subarray(12, 76);
          } else {
            sigFlags = 0x01; // Tauri always uses Blake2b-512 prehash
            sigKeyId = sigRaw.subarray(2, 10);
            sigBytes = sigRaw.subarray(10, 74);
          }

          check("Public key magic is 'Ed'", pubMagic === "Ed", `magic='${pubMagic}'`) || (allPass = false);
          check("Signature magic is 'ED' (minisign sig magic)", sigMagic === "ED" || sigMagic === "Ed", `magic='${sigMagic}'`) || (allPass = false);

          // Key ID must match between public key and signature
          const keyIdMatch = pubKeyId.equals(sigKeyId);
          check("Key ID matches between pubkey and signature", keyIdMatch, `pub=${pubKeyId.toString("hex")} sig=${sigKeyId.toString("hex")}`) || (allPass = false);

          // The prehash flag (bit 0) indicates Blake2b-512 prehash.
          // Tauri's updater uses prehash, so we hash the data with blake2b512.
          const usesPrehash = (sigFlags & 0x01) !== 0;
          check("Signature uses prehash (Blake2b-512)", usesPrehash, `flags=0x${sigFlags.toString(16).padStart(4, "0")}`) || (allPass = false);

          // Compute the prehash: blake2b-512 of the update binary
          const { createHash, createPublicKey, verify: cryptoVerify } = await import("node:crypto");
          const prehash = createHash("blake2b512").update(updateData).digest();

          // Wrap the raw 32-byte Ed25519 public key in SPKI DER format for Node.js crypto.
          // SPKI for Ed25519: 30 2a 30 05 06 03 2b 65 70 03 21 00 <32 bytes>
          const spkiDer = Buffer.concat([
            Buffer.from([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00]),
            pubKeyBytes,
          ]);
          const keyObj = createPublicKey({ key: spkiDer, format: "der", type: "spki" });

          // Verify the Ed25519 signature over the prehash.
          // Ed25519 in Node.js uses algorithm=null (the key type determines the algorithm).
          const isValid = cryptoVerify(null, prehash, keyObj, sigBytes);
          check("Ed25519 signature verifies over Blake2b-512 prehash", isValid, isValid ? "cryptographically valid ✓" : "INVALID — signature does not match") || (allPass = false);

          // Also verify that a tampered binary FAILS (negative test)
          const tamperedData = Buffer.concat([updateData.subarray(0, -1), Buffer.from([updateData[updateData.length - 1] ^ 0xff])]);
          const tamperedHash = createHash("blake2b512").update(tamperedData).digest();
          const tamperedValid = cryptoVerify(null, tamperedHash, keyObj, sigBytes);
          check("Tampered binary correctly REJECTS signature", !tamperedValid, !tamperedValid ? "rejected ✓" : "BUG: tampered data passed verification!") || (allPass = false);
        }
      } catch (e) {
        check("Cryptographic signature verification", false, e.message);
        allPass = false;
      }
    }
  }

  // 10. Verify .gitignore excludes the private key
  console.log("\n→ Checking .gitignore...");
  const gitignore = existsSync(join(REPO, ".gitignore"))
    ? readFileSync(join(REPO, ".gitignore"), "utf-8")
    : "";
  check(
    ".gitignore excludes updater private key",
    gitignore.includes("updater.key") || gitignore.includes("*.key") || gitignore.includes("updater-private"),
    gitignore.includes("*.key") ? "found (*.key glob)" : gitignore.includes("updater.key") ? "found" : "missing — private key could be committed!",
  ) || (allPass = false);

  // Write report
  const report = {
    suite: "sophos-updater-test",
    startedAt: new Date().toISOString(),
    results,
    summary: {
      total: results.length,
      passed: results.filter((r) => r.status).length,
      failed: results.filter((r) => !r.status).length,
      overall: allPass ? "PASS" : "FAIL",
    },
  };
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  console.log(`\n=== Result: ${allPass ? "PASS" : "FAIL"} (${report.summary.passed}/${report.summary.total} checks passed) ===`);
  console.log(`Report: ${REPORT_PATH}`);

  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error("Test failed with error:", e);
  process.exit(1);
});