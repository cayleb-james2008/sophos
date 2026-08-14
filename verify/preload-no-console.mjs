// verify/preload-no-console.mjs
// ---------------------------------------------------------------------------
// Automated evidence for the no-console-window preload (Piece P1).
//
// The preload (scripts/no-window-preload.cjs) is loaded via `node --require`
// before the daemon CLI. It defaults every daemon-side `child_process` spawn
// to `windowsHide: true` so grandchildren (kernels, shells, tools) don't flash
// console windows. `windowsHide` is the STARTUPINFO flag that determines
// console-window visibility, so the authoritative, deterministic assertion is
// the exact options the patched methods forward.
//
// This file asserts, deterministically and non-flaky:
//   A) All 6 methods default `windowsHide: true` when unspecified.
//   B) Explicit `windowsHide` (including `false`) is preserved.
//   C) The `(cmd, undefined, opts)` call form honors `opts` instead of forcing
//      the default (regression for an explicit `windowsHide: false`).
//   D) A real grandchild spawns cleanly through `node --require` (daemon-style
//      process: preload loaded before the main module).
//   E) Best-effort top-level-window enumeration: no new console window appears
//      while a console-touching child runs through the preloaded process.
//
// Usage: node verify/preload-no-console.mjs
// Exit 0 = all assertions pass.
// ---------------------------------------------------------------------------

import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { writeFileSync, mkdtempSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PRELOAD = join(ROOT, "scripts", "no-window-preload.cjs");

let pass = 0;
let fail = 0;
function check(name, ok, detail = "") {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}${detail ? " — " + detail : ""}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? " — " + detail : ""}`);
  }
}

// ---------------------------------------------------------------------------
// Load the preload, but capture the real implementations first so we can spy
// on the exact options each patched method forwards to the OS.
// ---------------------------------------------------------------------------
import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const cp = req("child_process");

// Install spies AFTER the preload so `orig` is the preload wrapper. We re-wrap
// each method and record the final forwarded argument list.
const forwarded = {};
for (const m of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync"]) {
  const real = cp[m];
  forwarded[m] = [];
  cp[m] = function (...a) {
    forwarded[m].push(a);
    // Return a benign placeholder; we only inspect the forwarded args.
    return { status: 0, stdout: Buffer.from(""), stderr: Buffer.from(""), pid: 0 };
  };
}

// Load the preload — patches cp.* (which are now the spies above).
req(PRELOAD);

// Helper: the options object is the (last) plain non-array object argument.
// For exec/execFile there may be a trailing `undefined` callback position, so
// scan from the end and skip null/undefined/arrays/functions.
function optsOf(args) {
  for (let i = args.length - 1; i >= 0; i--) {
    const a = args[i];
    if (a !== null && a !== undefined && typeof a === "object" && !Array.isArray(a)) return a;
  }
  return null;
}

// --- A) default windowsHide:true when unspecified -------------------------
cp.spawn("a");
cp.spawnSync("b", ["x"]);
cp.exec("echo hi");
cp.execSync("echo hi");
cp.execFile("node", ["-e", "0"]);
cp.execFileSync("node", ["-e", "0"]);

const defaults = [
  ["spawn", forwarded.spawn[0]],
  ["spawnSync", forwarded.spawnSync[0]],
  ["exec", forwarded.exec[0]],
  ["execSync", forwarded.execSync[0]],
  ["execFile", forwarded.execFile[0]],
  ["execFileSync", forwarded.execFileSync[0]],
];
for (const [name, args] of defaults) {
  const o = optsOf(args);
  check(`defaults windowsHide:true (${name})`, o && o.windowsHide === true, JSON.stringify(o));
}

// --- B) explicit windowsHide (incl. false) preserved ----------------------
const ex = forwarded; // reuse counters
cp.spawn("a2", { windowsHide: false });
cp.spawnSync("b2", ["x"], { windowsHide: false });
cp.exec("echo hi", { windowsHide: false });
cp.execSync("echo hi", { windowsHide: false });
cp.execFile("node", ["-e", "0"], { windowsHide: false });
cp.execFileSync("node", ["-e", "0"], { windowsHide: false });

check(
  "preserves explicit windowsHide:false (spawn)",
  optsOf(forwarded.spawn[1]).windowsHide === false
);
check(
  "preserves explicit windowsHide:false (spawnSync)",
  optsOf(forwarded.spawnSync[1]).windowsHide === false
);
check(
  "preserves explicit windowsHide:false (exec)",
  optsOf(forwarded.exec[1]).windowsHide === false
);
check(
  "preserves explicit windowsHide:false (execSync)",
  optsOf(forwarded.execSync[1]).windowsHide === false
);
check(
  "preserves explicit windowsHide:false (execFile)",
  optsOf(forwarded.execFile[1]).windowsHide === false
);
check(
  "preserves explicit windowsHide:false (execFileSync)",
  optsOf(forwarded.execFileSync[1]).windowsHide === false
);

// --- C) (cmd, undefined, opts) honors opts (explicit false preserved) -----
cp.spawnSync("c", undefined, { windowsHide: false });
const cIdx = forwarded.spawnSync.length - 1;
const cArgs = forwarded.spawnSync[cIdx];
const cOpts = optsOf(cArgs);
check(
  "(cmd, undefined, opts) honors explicit windowsHide:false",
  cOpts !== null && cOpts.windowsHide === false && cArgs.length === 2,
  `len=${cArgs.length} opts=${JSON.stringify(cOpts)}`
);

// --- D) real grandchild spawn through `node --require` --------------------
const realChild = spawnSync(
  process.execPath,
  ["--require", PRELOAD, "-e", "require('child_process').spawnSync(process.execPath,['-e','process.exit(0)']); process.exit(0)"],
  {}
);
check(
  "real grandchild spawns cleanly through preloaded process",
  realChild.status === 0,
  `status=${realChild.status}`
);

// --- E) best-effort: no new top-level console window while a child runs ---
function enumWindows() {
  // Write a self-contained PowerShell enumerator that prints visible top-level
  // window titles (one per line), so Node can diff them.
  const ps = join(tmpdir(), `enum-windows-${process.pid}.ps1`);
  writeFileSync(
    ps,
    `Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class WE${process.pid} {
  public delegate bool EP(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EP cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int m);
  public static List<string> Titles() {
    var l = new List<string>();
    EnumWindows((h, x) => { if (IsWindowVisible(h)) { var s = new StringBuilder(512); GetWindowText(h, s, 512); l.Add(s.ToString()); } return true; }, IntPtr.Zero);
    return l;
  }
}
"@
[WE${process.pid}]::Titles()`
  );
  const r = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps], {
    encoding: "utf8",
    windowsHide: true,
  });
  const before = new Set(
    (r.stdout || "")
      .split(/\r?\n/)
      .map((t) => t.trim())
      .filter(Boolean)
  );
  return before;
}

// Only meaningful on win32.
if (process.platform === "win32") {
  const before = enumWindows();
  // Spawn a console-touching child that lives ~1.5s through the PRELOADED
  // process (grandchild of the preload, like a daemon kernel/shell).
  const child = spawn(
    process.execPath,
    [
      "--require",
      PRELOAD,
      "-e",
      "const cp=require('child_process'); cp.spawnSync('cmd',['/c','ping -n 2 127.0.0.1 >nul']); process.exit(0)",
    ],
    { windowsHide: true }
  );
  // Enumerate mid-flight, while the child's grandchild may be alive.
  await new Promise((r) => setTimeout(r, 600));
  const after = enumWindows();
  await new Promise((r) => {
    child.on("exit", () => r());
    setTimeout(r, 4000);
  });
  const newWindows = [...after].filter((t) => !before.has(t));
  const consoleLike = newWindows.filter(
    (t) => /cmd|command prompt|console/i.test(t) && t.trim().length > 0
  );
  check(
    "no new console window appeared during preloaded grandchild spawn",
    consoleLike.length === 0,
    newWindows.length ? `new windows=${JSON.stringify(newWindows)}` : "no new top-level windows"
  );
} else {
  console.log("SKIP  top-level-window enumeration (non-Windows)");
  pass++;
}

// ---------------------------------------------------------------------------
console.log(`\n======== SUMMARY ========\nPASS: ${pass}  FAIL: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
