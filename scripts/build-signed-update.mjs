#!/usr/bin/env node
// scripts/build-signed-update.mjs
// Build a signed update package for the Tauri v2 auto-updater.
// Signs the update binary with the Ed25519 private key using the Tauri CLI signer.
//
// Usage: node scripts/build-signed-update.mjs [--version 0.2.0]
//
// Output:
//   scripts/update-binary.bin  → the update binary (dummy for testing)
//   scripts/update.sig         → the minisign signature (base64)
//
// For a real release, you would:
//   1. Build the NSIS installer: npm run tauri build
//   2. Sign the installer: npx tauri signer sign -k scripts/updater.key <installer-path>
//   3. Read the signature from the .sig file
//   4. Upload the installer + manifest to your update server

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..");

const args = process.argv.slice(2);
const versionIdx = args.indexOf("--version");
const version = versionIdx !== -1 ? args[versionIdx + 1] : "0.2.0";

const keyPath = join(__dirname, "updater.key");
const updatePath = join(__dirname, "update-binary.bin");
const sigPath = join(__dirname, "update.sig");

if (!existsSync(keyPath)) {
  console.error("Private key not found at scripts/updater.key");
  console.error("Run `node scripts/gen-updater-keys.mjs` first.");
  process.exit(1);
}

// Create a dummy update binary (in production, this would be the NSIS installer)
console.log(`Creating update binary (v${version})...`);
writeFileSync(updatePath, Buffer.from(`SOPHOS_UPDATE_DUMMY_BINARY_V${version}`));

// Sign the update binary using the Tauri CLI signer
// The TAURI_SIGNING_PRIVATE_KEY_PASSWORD env var must be set (empty for dev)
console.log("Signing update binary with Tauri CLI signer...");

try {
  // Use env vars for the key path + password (the -k flag expects key
  // content directly, not a file path — using TAURI_SIGNING_PRIVATE_KEY_PATH
  // avoids the base64 decode error on Windows drive-letter paths).
  const env = {
    ...process.env,
    TAURI_SIGNING_PRIVATE_KEY_PATH: keyPath,
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "",
  };

  // Use the Tauri CLI to sign the file
  const cmd = `npx tauri signer sign "${updatePath}"`;
  console.log(`  Running: ${cmd}`);
  console.log(`  TAURI_SIGNING_PRIVATE_KEY_PATH=${keyPath}`);

  // The signer writes a .sig file next to the input
  execSync(cmd, {
    stdio: "pipe",
    cwd: REPO,
    env,
  });

  // Read the generated signature
  const generatedSigPath = updatePath + ".sig";
  if (existsSync(generatedSigPath)) {
    const sig = readFileSync(generatedSigPath, "utf-8").trim();
    // The .sig file contains a comment line + the signature line
    // The Tauri updater expects just the base64 signature content
    writeFileSync(sigPath, sig);
    console.log(`\n✓ Update binary signed:`);
    console.log(`  Binary:    ${updatePath} (${readFileSync(updatePath).length} bytes)`);
    console.log(`  Signature: ${sigPath}`);
    console.log(`  Signature content (first 80 chars): ${sig.substring(0, 80)}...`);
  } else {
    // If the .sig file wasn't created, try reading from stdout
    console.error("Signature file not found. The Tauri signer may have output to stdout.");
    console.error("Attempting to capture from stdout...");
    try {
      const stdout = execSync(cmd, { cwd: REPO, env, encoding: "utf-8" });
      const sigMatch = stdout.match(/([A-Za-z0-9+/=\n]+)/);
      if (sigMatch) {
        writeFileSync(sigPath, sigMatch[1].trim());
        console.log(`✓ Signature captured from stdout: ${sigPath}`);
      } else {
        throw new Error("Could not parse signature from stdout");
      }
    } catch (e) {
      console.error("Failed to sign update binary:", e.message);
      process.exit(1);
    }
  }
} catch (e) {
  console.error("Failed to sign update binary:", e.message);
  console.error("\nMake sure:");
  console.error("  1. The private key exists at scripts/updater.key");
  console.error("  2. The TAURI_SIGNING_PRIVATE_KEY_PASSWORD env var is set correctly");
  console.error("  3. The Tauri CLI is installed (npm install)");
  process.exit(1);
}

console.log("\nNext steps:");
console.log("  1. Run `node scripts/serve-update-feed.mjs` to serve the manifest");
console.log("  2. Run `node verify/updater-test.mjs` to verify the update flow");