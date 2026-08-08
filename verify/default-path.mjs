// Proves the env gate: named pipe stays the default; tcp:// only when opted in.
import { pathToFileURL } from "node:url";
const INDEX =
  process.env.REF
    ? process.env.REF + "/dist/index.js"
    : "C:/Users/Cayleb/Desktop/workspace/prime-agent-ref/packages/coding-agent/dist/index.js";
const { defaultDaemonSocketPath } = await import(pathToFileURL(INDEX).href);

delete process.env.PRIME_DAEMON_TCP;
delete process.env.PRIME_DAEMON_TCP_PORT;
const def = defaultDaemonSocketPath();

process.env.PRIME_DAEMON_TCP = "1";
const tcp = defaultDaemonSocketPath();

process.env.PRIME_DAEMON_TCP_PORT = "48222";
const tcp2 = defaultDaemonSocketPath();

const expectedPipe = "\\\\.\\pipe\\prime-agent-daemon"; // real value: \\.\pipe\prime-agent-daemon
console.log("default (no env)  :", def);
console.log("env=1             :", tcp);
console.log("env=1 port=48222  :", tcp2);

const okPipe = process.platform === "win32" ? def === expectedPipe : def.endsWith("/daemon.sock");
const okTcp = tcp === "tcp://127.0.0.1:48100";
const okTcp2 = tcp2 === "tcp://127.0.0.1:48222";
console.log("ASSERT default-unchanged:", okPipe, "| tcp gate:", okTcp, "| port override:", okTcp2);
process.exit(okPipe && okTcp && okTcp2 ? 0 : 1);
