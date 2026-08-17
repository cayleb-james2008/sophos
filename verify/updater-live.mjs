#!/usr/bin/env node
// verify/updater-live.mjs — LIVE auto-updater apply test (v0.7.2).
//
// Proves the full update flow against the INSTALLED Sophos build:
//   1. Real feed: launch the installed app; its startup check hits the live
//      feed, finds the current version, and shows NO banner.
//   2. Staging feed: relaunch with SOPHOS_UPDATE_ENDPOINT pointing at a
//      LOCAL HTTPS feed (self-signed cert; the override path relaxes TLS)
//      announcing a NEWER version (0.7.3) that serves the signed 0.7.2
//      installer. The "Update available" banner appears, Install downloads +
//      Ed25519-verifies + installs, the app relaunches, and the new instance
//      runs 0.7.2 with no banner (its own check against the real feed is up
//      to date).
//
// Requires: the installed app ($LOCALAPPDATA\Sophos), the signed installer
// for the current version, and a running cua-driver. Environment-specific —
// deliberately NOT part of run-all.mjs.
//
// Run:  node verify/updater-live.mjs

import { spawn, execSync, execFileSync } from "node:child_process";
import { createServer as createHttpsServer } from "node:https";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { getWindowState, sleep, startDaemon, stopDaemon } from "./cua/driver.mjs";
import { waitForWindow } from "./cua/launch.mjs";
import { enableWebContentAccessibility } from "./cua/demo-launch.mjs";
import { findBy, clickBy, waitFor } from "./cua/find-util.mjs";
import { getTextContent } from "./cua/helpers.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..");

const INSTALLED_EXE = join(process.env.LOCALAPPDATA || "", "Sophos", "prime-agent-windows.exe");
const INSTALLER = join(
  REPO,
  "src-tauri",
  "target",
  "release",
  "bundle",
  "nsis",
  "Sophos_0.7.2_x64-setup.exe",
);
const SIG = readFileSync(INSTALLER + ".sig", "utf-8").trim();
const FEED_PORT = 37833;
const FEED_URL = `https://127.0.0.1:${FEED_PORT}/manifest.json`;

// Self-signed cert for the local https staging feed. The updater plugin
// rejects non-https endpoints in release builds, and the app's
// SOPHOS_UPDATE_ENDPOINT override relaxes TLS validation, so an https
// loopback server with a throwaway cert is the test vehicle.
const CERT = join(tmpdir(), "sophos-feed-cert.pem");
const KEY = join(tmpdir(), "sophos-feed-key.pem");
execSync(
  `openssl req -x509 -newkey rsa:2048 -keyout "${KEY}" -out "${CERT}" -days 1 -nodes -subj "/CN=127.0.0.1"`,
  { stdio: "ignore" },
);

let pass = 0;
let fail = 0;
const ok = (name, cond, detail = "") => {
  cond ? pass++ : fail++;
  console.log(`${cond ? "✅" : "❌"} ${name}${detail ? " — " + detail : ""}`);
};

/** Fetch a fresh window state. */
const fresh = (pid, windowId) => getWindowState(pid, windowId, { include_screenshot: false });

/** Assert the window text contains / lacks a case-insensitive substring. */
function hasText(pid, windowId, needle) {
  return getTextContent(fresh(pid, windowId)).toLowerCase().includes(String(needle).toLowerCase());
}

/** Launch the installed app in demo mode, optionally with an endpoint override. */
async function launchInstalled(endpoint) {
  const child = spawn(
    INSTALLED_EXE,
    ["--demo"],
    endpoint
      ? { env: { ...process.env, SOPHOS_UPDATE_ENDPOINT: endpoint }, stdio: "ignore" }
      : { env: { ...process.env }, stdio: "ignore" },
  );
  const { pid, windowId } = await waitForWindow(child.pid, 20000);
  await enableWebContentAccessibility(pid, windowId);
  return { pid, windowId, child };
}

/** Find the pid of the installed-path app started after `after` (ISO string). */
function installedPidAfter(afterIso) {
  try {
    const out = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Get-Process prime-agent-windows -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq '${INSTALLED_EXE}' -and $_.StartTime -gt [datetime]'${afterIso}' } | Select-Object -First 1 -ExpandProperty Id`,
      ],
      { encoding: "utf-8" },
    ).trim();
    return out ? Number(out) : null;
  } catch {
    return null; // not found yet — the polling loop keeps looking
  }
}

const t0 = new Date().toISOString();

const daemon = startDaemon();
const daemonStartedByUs = !daemon.alreadyRunning;
process.on("exit", () => {
  if (daemonStartedByUs) {
    try {
      stopDaemon();
    } catch {}
  }
});

// ---------------------------------------------------------------------------
// Part 1 — real feed: no banner, current version in the footer.
// ---------------------------------------------------------------------------
console.log("=== Part 1: real feed check (up to date) ===");
const a = await launchInstalled();
try {
  // Give the startup check time to complete against the live feed.
  await sleep(12000);
  ok("app shows the current version in the footer", hasText(a.pid, a.windowId, "0.7.2"));
  ok("no update banner on the real feed (0.7.2 == 0.7.2)", !hasText(a.pid, a.windowId, "update available"));
} finally {
  try {
    execSync(`taskkill /F /T /PID ${a.pid} 2>nul`, { stdio: "ignore" });
  } catch {}
  await sleep(1500);
}

// ---------------------------------------------------------------------------
// Part 2 — staging feed: banner appears, install applies, app relaunches.
// ---------------------------------------------------------------------------
console.log("\n=== Part 2: apply flow via staging feed (0.7.3 > 0.7.2) ===");
const installerBytes = readFileSync(INSTALLER);
const server = createHttpsServer(
  { key: readFileSync(KEY), cert: readFileSync(CERT) },
  (req, res) => {
    const url = (req.url || "").split("?")[0];
    if (url === "/manifest.json") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          version: "0.7.3",
          notes: "Sophos v0.7.3 (staging apply test) — binary served here is the signed 0.7.2 installer.",
          pub_date: new Date().toISOString(),
          channel: "beta",
          platforms: {
            "windows-x86_64": {
              url: `https://127.0.0.1:${FEED_PORT}/installer.exe`,
              signature: SIG,
            },
          },
        }),
      );
    } else if (url === "/installer.exe") {
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      res.end(installerBytes);
    } else {
      res.writeHead(404);
      res.end();
    }
  },
);
await new Promise((r) => server.listen(FEED_PORT, "127.0.0.1", r));

let b;
try {
  b = await launchInstalled(FEED_URL);
  const banner = await waitFor(fresh(b.pid, b.windowId), { text: "Update available" }, 45000);
  ok("update banner appears (staging feed announces 0.7.3)", !!banner);
  if (banner) {
    ok("banner names the announced version", hasText(b.pid, b.windowId, "0.7.3"));
    clickBy(b.pid, fresh(b.pid, b.windowId), { role: "Button", text: "Install" });
    console.log("   … clicked Install; waiting for download + install + relaunch…");

    // The app downloads, verifies, runs the silent installer, and exits.
    let exited = false;
    for (let i = 0; i < 50; i++) {
      try {
        process.kill(b.pid, 0);
      } catch {
        exited = true;
        break;
      }
      await sleep(3000);
    }
    ok("old app instance exited after install", exited);

    // The installer relaunches the app — find the new installed-path process.
    let newPid = null;
    for (let i = 0; i < 50 && !newPid; i++) {
      newPid = installedPidAfter(t0);
      if (!newPid) await sleep(3000);
    }
    ok("app relaunched from the installed path", !!newPid, newPid ? `pid=${newPid}` : "");
    if (newPid) {
      const { pid, windowId } = await waitForWindow(newPid, 20000);
      await enableWebContentAccessibility(pid, windowId);
      await sleep(12000);
      ok("relaunched app runs 0.7.2 (footer)", hasText(pid, windowId, "0.7.2"));
      // Note: the installer relaunches the app without --demo, inheriting the
      // test env, so it may re-offer the staging update — that's harness
      // noise, not part of the proof. The final state (fresh launch against
      // the real feed) is verified in Part 3 below.
      // Verify the installed exe is the 0.7.2 build.
      const fv = execFileSync(
        "powershell.exe",
        ["-NoProfile", "-Command", `(Get-Item '${INSTALLED_EXE}').VersionInfo.FileVersion`],
        { encoding: "utf-8" },
      ).trim();
      ok("installed exe FileVersion is 0.7.2", fv === "0.7.2", `FileVersion=${fv}`);
      try {
        execSync(`taskkill /F /T /PID ${pid} 2>nul`, { stdio: "ignore" });
      } catch {}
      await sleep(2000);

      // Final state: a fresh launch WITHOUT the override checks the REAL feed
      // and must show no banner (0.7.2 == 0.7.2).
      console.log("\n=== Part 3: fresh launch against the real feed (final state) ===");
      const c = await launchInstalled();
      try {
        await sleep(12000);
        ok("fresh app runs 0.7.2 (footer)", hasText(c.pid, c.windowId, "0.7.2"));
        ok("no update banner on the real feed (0.7.2 == 0.7.2)", !hasText(c.pid, c.windowId, "update available"));
      } finally {
        try {
          execSync(`taskkill /F /T /PID ${c.pid} 2>nul`, { stdio: "ignore" });
        } catch {}
      }
    }
  }
} finally {
  server.close();
}

console.log(`\n=== LIVE UPDATER APPLY TEST: ${fail === 0 ? "PASS" : "FAIL"} (${pass} passed, ${fail} failed) ===`);
process.exit(fail === 0 ? 0 : 1);
