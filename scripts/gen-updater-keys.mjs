#!/usr/bin/env node
// scripts/gen-updater-keys.mjs
// Generate an Ed25519 signing key pair for the Tauri v2 auto-updater.
// Uses the Tauri CLI's built-in signer (minisign-compatible format).
//
// Usage: node scripts/gen-updater-keys.mjs [--force]
// Output: scripts/updater.key (private) + scripts/updater.key.pub (public)
//
// The public key goes into src-tauri/tauri.conf.json → plugins.updater.pubkey.
// The private key is used by scripts/build-signed-update.mjs to sign updates.
// NEVER commit the private key — it's in .gitignore.

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const keyPath = join(__dirname, "updater.key");
const pubPath = join(__dirname, "updater.key.pub");

const args = process.argv.slice(2);
const force = args.includes("--force") || args.includes("-f");

if (existsSync(keyPath) && !force) {
  console.error("Private key already exists at scripts/updater.key");
  console.error("Use --force to overwrite.");
  process.exit(1);
}

// Use the Tauri CLI to generate the key pair (minisign-compatible format).
// Empty password for development/testing — set a real password for production.
const cmd = `npx tauri signer generate -w "${keyPath}" --ci -p "" ${force ? "-f" : ""}`;
console.log("Generating Ed25519 key pair via Tauri CLI...");
execSync(cmd, { stdio: "pipe", cwd: join(__dirname, "..") });

if (!existsSync(pubPath)) {
  // The CLI might write the .pub file alongside the key
  const altPub = keyPath + ".pub";
  if (existsSync(altPub)) {
    // Already written by the CLI
  } else {
    console.error("Public key file not found after generation.");
    process.exit(1);
  }
}

const pubkey = readFileSync(pubPath, "utf-8").trim();
console.log("\n✓ Key pair generated:");
console.log(`  Private: ${keyPath} (keep secret!)`);
console.log(`  Public:  ${pubPath}`);
console.log(`\nPublic key (add to tauri.conf.json → plugins.updater.pubkey):`);
console.log(pubkey);
console.log("\nNext steps:");
console.log("  1. Copy the public key above into src-tauri/tauri.conf.json");
console.log("  2. Use scripts/build-signed-update.mjs to sign update packages");
console.log("  3. Use scripts/serve-update-feed.mjs to serve the update manifest");