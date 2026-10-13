import assert from "node:assert/strict";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const RESOURCES_ROOT = join(PROJECT_ROOT, "resources");
const requireFromResources = createRequire(join(RESOURCES_ROOT, "runtime-entry.cjs"));
const getUri = requireFromResources("get-uri").getUri;
const { Client } = requireFromResources("basic-ftp");

function readRuntimePackageVersion(name) {
  return JSON.parse(readFileSync(join(RESOURCES_ROOT, "node_modules", name, "package.json"), "utf8")).version;
}

test("patched basic-ftp fixes the listing DoS without changing the pinned proxy-agent major", () => {
  assert.equal(readRuntimePackageVersion("basic-ftp"), "6.2.1");
  assert.equal(readRuntimePackageVersion("get-uri"), "6.0.5");
  assert.equal(readRuntimePackageVersion("pac-proxy-agent"), "7.2.0");
  assert.equal(readRuntimePackageVersion("proxy-agent"), "6.5.0");

  const client = new Client();
  const attackLine = `-rw-r--r-- 1 ${"owner ".repeat(5_000)}missing-size-and-date\r\n`;
  const validLine = "-rw-r--r-- 1 owner group 14 Jan 01 00:00 safe.txt\r\n";
  const startedAt = performance.now();
  const listing = client.parseList(attackLine + validLine);
  const elapsedMs = performance.now() - startedAt;

  assert.ok(listing.some((entry) => entry.name === "safe.txt"));
  assert.ok(elapsedMs < 500, `untrusted FTP listing parser took ${elapsedMs.toFixed(1)}ms`);
  client.close();
});

test(
  "get-uri 6.0.5 still performs a complete FTP read with patched basic-ftp",
  { timeout: 10_000 },
  async (t) => {
    let activeDataSocket;
    let passiveServer;
    let fixtureSocketError;
    let retrievalAcknowledged = false;
    let resolveControlClosed;
    const controlClosed = new Promise((resolve) => {
      resolveControlClosed = resolve;
    });
    const controlServer = createServer((control) => {
      control.on("error", (error) => {
        fixtureSocketError ??= error;
      });
      control.once("close", resolveControlClosed);
      control.setEncoding("utf8");
      control.write("220 local fixture ready\r\n");
      let pending = "";
      control.on("data", (chunk) => {
        pending += chunk;
        let index;
        while ((index = pending.indexOf("\r\n")) !== -1) {
          const line = pending.slice(0, index);
          pending = pending.slice(index + 2);
          const [command] = line.split(" ", 1);
          const upper = command.toUpperCase();

          if (["OPTS", "TYPE", "STRU"].includes(upper)) {
            control.write("200 command ok\r\n");
          } else if (upper === "USER") {
            control.write("230 logged in\r\n");
          } else if (upper === "FEAT") {
            control.write("211-Features\r\n MLST type*;size*;modify*;\r\n211 End\r\n");
          } else if (upper === "MDTM") {
            control.write("500 MDTM unsupported\r\n");
          } else if (upper === "EPSV") {
            passiveServer = createServer((socket) => {
              activeDataSocket = socket;
              socket.on("error", (error) => {
                fixtureSocketError ??= error;
              });
            });
            passiveServer.listen(0, "127.0.0.1", () => {
              const address = passiveServer.address();
              control.write(`229 Entering Extended Passive Mode (|||${address.port}|)\r\n`);
            });
          } else if (["MLSD", "RETR"].includes(upper)) {
            const data = activeDataSocket;
            activeDataSocket = undefined;
            if (!data) {
              control.write("425 no passive data socket\r\n");
              continue;
            }
            control.write("150 opening data connection\r\n");
            const body =
              upper === "MLSD"
                ? "type=file;size=14;modify=20241013120000; safe.txt\r\n"
                : "local fixture payload";
            data.once("close", () =>
              setTimeout(() => {
                if (control.destroyed) return;
                control.write("226 transfer complete\r\n");
                if (upper === "RETR") retrievalAcknowledged = true;
              }, 25),
            );
            data.end(body);
            passiveServer.close();
            passiveServer = undefined;
          } else if (upper === "QUIT") {
            control.write("221 goodbye\r\n");
          } else {
            control.write("200 command ok\r\n");
          }
        }
      });
    });

    await new Promise((resolveListen, reject) => {
      controlServer.once("error", reject);
      controlServer.listen(0, "127.0.0.1", resolveListen);
    });
    t.after(async () => {
      activeDataSocket?.destroy();
      passiveServer?.close();
      controlServer.closeAllConnections?.();
      await new Promise((resolveClose) => controlServer.close(resolveClose));
    });

    const address = controlServer.address();
    const stream = await getUri(new URL(`ftp://127.0.0.1:${address.port}/safe.txt`));
    const chunks = [];
    await new Promise((resolveEnd, reject) => {
      stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      stream.once("end", resolveEnd);
      stream.once("error", reject);
    });

    // get-uri exposes the download stream's EOF before its FTP transfer promise
    // receives the final 226 reply and closes the control socket. Wait for that
    // protocol completion so Windows cleanup does not reset an active socket.
    let closeTimeout;
    try {
      await Promise.race([
        controlClosed,
        new Promise((_, reject) => {
          closeTimeout = setTimeout(
            () => reject(new Error("FTP control connection did not close after RETR")),
            2_000,
          );
        }),
      ]);
    } finally {
      clearTimeout(closeTimeout);
    }
    assert.equal(fixtureSocketError, undefined, `FTP fixture socket failed: ${fixtureSocketError?.message}`);
    assert.equal(retrievalAcknowledged, true, "FTP client must receive the final RETR completion reply");

    assert.equal(Buffer.concat(chunks).toString("utf8"), "local fixture payload");
    assert.ok(stream.lastModified instanceof Date);
  },
);
