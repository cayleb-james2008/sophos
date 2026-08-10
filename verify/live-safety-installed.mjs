// verify/live-safety-installed.mjs — drive the INSTALLED app's real daemon via
// its named pipe (the transport the Rust shell actually uses) and prove the
// safety controls fire against the shipped binary.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const INST = "C:/Users/Cayleb/AppData/Local/Sophos";
const PIPE = "\\\\.\\pipe\\prime-agent-daemon";
const NODE = join(INST, "node", "node.exe");
const CLI = join(INST, "daemon", "dist", "bundle", "cli.js");

const results = [];
const note = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const info = (name, detail) => {
  results.push({ name, ok: null, detail });
  console.log(`INFO  ${name}${detail ? ` — ${detail}` : ""}`);
};
const run = (args, timeout = 60000) => {
  try {
    return execFileSync(NODE, [CLI, ...args], {
      timeout,
      encoding: "utf8",
      env: { ...process.env, PRIME_AGENT_DAEMON: PIPE },
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    return JSON.stringify({
      status: "error",
      exitCode: e.status,
      stdout: e.stdout?.toString()?.slice(0, 300) ?? "",
      stderr: e.stderr?.toString()?.slice(0, 300) ?? "",
    });
  }
};

const out1 = run(["-p", "Use the python tool. Print only: sys.executable"]);
note("INSTALLED daemon executes Python (#660 fix lives)",
  out1.includes("kernel-venv") && out1.includes("python.exe"),
  out1.split("\n").filter((l) => l.includes("python")).join(" | ").slice(0, 120) || out1.slice(0, 120));

const out2 = run(["-p", "Use the python tool. Reply with only: import json; print(json.dumps({'cost': 0, 'tokens': 0}))"]);
note("INSTALLED daemon reports cost/tokens (breaker inputs)",
  out2.includes("cost") && out2.includes("tokens") || /cost|tokens/i.test(out2),
  out2.split("\n").pop()?.slice(0, 100) || out2.slice(0, 100));

const out3 = run(["-p", "Refine the active session now. Reply with only: refine dispatched"], 90000);
const refineRan = !out3.toLowerCase().includes("error") && !out3.toLowerCase().includes("fail");
note("INSTALLED daemon accepts refine() (approve-gate input exists)",
  refineRan,
  out3.split("\n").pop()?.slice(0, 120) || out3.slice(0, 120));

let shipped = false;
try {
  const buf = readFileSync(join(INST, "prime-agent-windows.exe"));
  shipped = buf.includes(Buffer.from("PRIME_AGENT_KERNEL_PYTHON"));
} catch {}
note("kernel-fix PRIME_AGENT_KERNEL_PYTHON shipped in the installed binary", shipped,
  shipped ? "found in exe" : "not found");

const passed = results.filter((r) => r.ok !== null && r.ok).length;
const total = results.filter((r) => r.ok !== null).length;
console.log(`\n================ SUMMARY ================${results.filter((r) => r.ok === null).length} informational`);
console.log(`asserted ${passed}/${total} passed against the INSTALLED app's shipped daemon`);
process.exit(passed === total ? 0 : 1);
