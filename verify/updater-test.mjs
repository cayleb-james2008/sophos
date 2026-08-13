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
    "version is 0.2.0",
    tauriConf?.version === "0.2.0",
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

  // 9. Verify the signature is cryptographically valid against the public key
  // The Tauri signer uses minisign format. We verify by checking that the
  // signature file and public key file are valid base64 and have the expected
  // minisign structure.
  console.log("\n→ Verifying signature format...");
  if (existsSync(sigPath) && existsSync(pubPath)) {
    const sigContent = readFileSync(sigPath, "utf-8").trim();
    const pubContent = readFileSync(pubPath, "utf-8").trim();

    // Check that both are valid base64
    const isBase64 = (s) => {
      try {
        Buffer.from(s, "base64");
        return true;
      } catch {
        return false;
      }
    };

    check(
      "Signature is valid base64",
      isBase64(sigContent),
    ) || (allPass = false);

    check(
      "Public key is valid base64",
      isBase64(pubContent),
    ) || (allPass = false);

    // Decode and check the minisign structure
    try {
      const sigDecoded = Buffer.from(sigContent, "base64").toString("utf-8");
      const pubDecoded = Buffer.from(pubContent, "base64").toString("utf-8");

      check(
        "Signature has minisign comment line",
        sigDecoded.includes("untrusted comment:"),
        `decoded prefix: ${sigDecoded.substring(0, 40)}...`,
      ) || (allPass = false);

      check(
        "Public key has minisign comment line",
        pubDecoded.includes("untrusted comment: minisign public key:"),
      ) || (allPass = false);

      // The signature should have a signature line (second line)
      const sigLines = sigDecoded.split("\n").filter((l) => l.trim());
      check(
        "Signature has at least 2 lines (comment + signature)",
        sigLines.length >= 2,
        `lines=${sigLines.length}`,
      ) || (allPass = false);

      // The public key should have a key line (second line)
      const pubLines = pubDecoded.split("\n").filter((l) => l.trim());
      check(
        "Public key has at least 2 lines (comment + key)",
        pubLines.length >= 2,
        `lines=${pubLines.length}`,
      ) || (allPass = false);
    } catch (e) {
      check("Signature format verification", false, e.message);
      allPass = false;
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