// Bridge entry point.
//
// Wires the ConnectionHolder (which owns the daemon connection) to the
// RpcServer (which owns the stdio JSON-RPC surface). On startup it tries
// to connect to the daemon, emits a `connection_status` event, and then
// begins reading commands from stdin.
//
// Process model:
//   * Spawned by the Rust shell (prime-agent-windows shell). Stdin/stdout are
//     line-buffered pipes. The Rust shell writes one IpcCommand per line and
//     reads one IpcEvent / RpcResponse per line.
//   * Stderr is reserved for diagnostics; the Rust shell surfaces it to logs.
//   * SIGINT/SIGTERM triggers a clean shutdown: dispose connection, flush.

import process from "node:process";

import { ConnectionHolder } from "./connection.js";
import { RpcServer } from "./rpc.js";

function log(line: string): void {
  process.stderr.write(`[bridge] ${line}\n`);
}

function socketPathFromArgs(args: readonly string[] = process.argv.slice(2)): string | undefined {
  const flag = "--daemon-socket";
  const index = args.indexOf(flag);
  if (index >= 0) {
    const value = args[index + 1]?.trim();
    if (value) return value;
  }
  const inline = args.find((arg) => arg.startsWith(`${flag}=`));
  const value = inline?.slice(flag.length + 1).trim();
  return value || undefined;
}

async function main(): Promise<void> {
  // Declare server first so the holder's onEvent callback can close over it
  // without a temporal-dead-zone trap if either order is ever swapped.
  let server: RpcServer | undefined;

  // The bridge normally follows the daemon's default socket. Verification
  // harnesses may pass the same explicit socket flag as the daemon CLI.
  const socketPath = socketPathFromArgs();
  if (socketPath) log(`using daemon socket override ${socketPath}`);
  const holder = new ConnectionHolder(
    { onEvent: (event) => server?.emitEvent(event) },
    socketPath ? { socketPath } : {},
  );

  server = new RpcServer(holder, {
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
  });

  // Begin reading commands immediately so the Rust shell can dispatch even
  // before the daemon connection is established (commands that need a
  // connection will surface a JSON-RPC error in the meantime).
  server.start();

  // Initial status event — the shell and React client use this to render the
  // "connecting" badge while we attempt the daemon handshake.
  server.emitEvent({ type: "connection_status", status: { kind: "connecting" } });

  // Graceful shutdown wiring.
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`received ${signal}, shutting down`);
    try {
      await holder.disconnect();
    } catch (err) {
      log(`disconnect error: ${err instanceof Error ? err.message : String(err)}`);
    }
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  // Attempt the initial connection. If this throws the holder emits a
  // disconnected event; the Rust shell can decide whether to retry or
  // surface the failure to the user.
  try {
    await holder.connect();
  } catch (err) {
    log(`initial connect failed: ${err instanceof Error ? err.message : String(err)}`);
    // Re-emit disconnected for the shell's bookkeeping — holder.connect()
    // already emitted one but we make it explicit on the failure path.
    server.emitEvent({
      type: "connection_status",
      status: { kind: "disconnected", reason: err instanceof Error ? err.message : String(err) },
    });
  }
}

main().catch((err) => {
  log(`fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exit(1);
});
