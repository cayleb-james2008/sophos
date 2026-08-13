#!/usr/bin/env node
// scripts/serve-update-feed.mjs
// A local HTTP server that serves a Tauri v2 updater manifest + update binary.
// Used for testing the auto-updater flow without a real release server.
//
// Usage: node scripts/serve-update-feed.mjs [--port 37822] [--version 0.2.0]
//
// Serves:
//   GET /manifest.json  → the update manifest (version, notes, platforms)
//   GET /update          → the update binary (a dummy file for testing)
//
// The manifest format matches the Tauri v2 updater spec:
//   {
//     "version": "0.2.0",
//     "notes": "Test update",
//     "pub_date": "2026-08-12T00:00:00Z",
//     "platforms": {
//       "windows-x86_64": { "url": "http://127.0.0.1:37822/update", "signature": "..." }
//     }
//   }

import { createServer } from "node:http";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..");

const args = process.argv.slice(2);
const portIdx = args.indexOf("--port");
const port = portIdx !== -1 ? parseInt(args[portIdx + 1], 10) : 37822;
const versionIdx = args.indexOf("--version");
const version = versionIdx !== -1 ? args[versionIdx + 1] : "0.2.0";

// Read the signature from a file if it exists, otherwise use a placeholder.
const sigPath = join(__dirname, "update.sig");
const updatePath = join(__dirname, "update-binary.bin");

// Create a dummy update binary if it doesn't exist
if (!existsSync(updatePath)) {
  writeFileSync(updatePath, Buffer.from("SOPHOS_UPDATE_DUMMY_BINARY_V" + version));
}

const server = createServer((req, res) => {
  const url = req.url?.split("?")[0];

  if (url === "/manifest.json") {
    let signature = "";
    if (existsSync(sigPath)) {
      signature = readFileSync(sigPath, "utf-8").trim();
    }

    const manifest = {
      version,
      notes: `Sophos ${version} — test update for auto-updater verification`,
      pub_date: new Date().toISOString(),
      platforms: {
        "windows-x86_64": {
          url: `http://127.0.0.1:${port}/update`,
          signature,
        },
      },
    };

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(manifest, null, 2));
    console.log(`[${new Date().toISOString()}] GET /manifest.json → 200 (v${version})`);
    return;
  }

  if (url === "/update") {
    if (!existsSync(updatePath)) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const data = readFileSync(updatePath);
    res.writeHead(200, { "Content-Type": "application/octet-stream" });
    res.end(data);
    console.log(`[${new Date().toISOString()}] GET /update → 200 (${data.length} bytes)`);
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Sophos update feed server running at http://127.0.0.1:${port}`);
  console.log(`  Manifest:  http://127.0.0.1:${port}/manifest.json`);
  console.log(`  Update:    http://127.0.0.1:${port}/update`);
  console.log(`  Version:   ${version}`);
  console.log(`  Signature: ${existsSync(sigPath) ? "loaded from update.sig" : "NOT SET — run build-signed-update.mjs first"}`);
  console.log(`\nPress Ctrl+C to stop.`);
});

// Handle clean shutdown
process.on("SIGINT", () => {
  server.close();
  console.log("\nUpdate feed server stopped.");
  process.exit(0);
});