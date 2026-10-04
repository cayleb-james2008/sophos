import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, rename, rm, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { NODE_RUNTIME_PIN } from "./runtime-pins.mjs";

export async function validateNodeExecutable(executablePath, pin = NODE_RUNTIME_PIN) {
  const details = await stat(executablePath).catch(() => undefined);
  if (!details?.isFile()) throw new Error(`Node executable is missing or not a file: ${executablePath}`);
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(executablePath)) hash.update(chunk);
  const actual = hash.digest("hex");
  if (actual !== pin.sha256) {
    throw new Error(`Node runtime SHA-256 mismatch: found ${actual}, expected ${pin.sha256}`);
  }
  return { path: resolve(executablePath), version: pin.version, sha256: actual };
}

async function downloadOfficialNode(executablePath, pin) {
  const partialPath = `${executablePath}.download`;
  await rm(partialPath, { force: true });
  try {
    const response = await fetch(pin.url, {
      redirect: "error",
      signal: AbortSignal.timeout(180_000),
    });
    if (!response.ok || !response.body) {
      throw new Error(`Node runtime download failed: HTTP ${response.status} from ${pin.url}`);
    }
    await pipeline(Readable.fromWeb(response.body), createWriteStream(partialPath, { flags: "wx" }));
    await validateNodeExecutable(partialPath, pin);
    await rename(partialPath, executablePath);
  } catch (error) {
    await rm(partialPath, { force: true }).catch(() => {});
    throw error;
  }
}

export async function ensureNodeRuntime(worktreeRoot, { source = process.env.PRIME_NODE_RUNTIME, pin = NODE_RUNTIME_PIN } = {}) {
  const runtimeDir = join(worktreeRoot, "resources", "node", `node-v${pin.version}-${pin.platform}`);
  const executablePath = join(runtimeDir, "node.exe");
  await mkdir(runtimeDir, { recursive: true });

  try {
    return await validateNodeExecutable(executablePath, pin);
  } catch (error) {
    if (error.message.startsWith("Node runtime SHA-256 mismatch")) throw error;
  }

  const partialPath = `${executablePath}.download`;
  await rm(partialPath, { force: true });
  try {
    if (source) {
      const sourcePath = resolve(source);
      const sourceDetails = await stat(sourcePath).catch(() => undefined);
      const sourceExecutable = sourceDetails?.isDirectory() ? join(sourcePath, "node.exe") : sourcePath;
      if (resolve(sourceExecutable) === resolve(executablePath)) {
        throw new Error(`configured Node runtime is missing or invalid: ${sourceExecutable}`);
      }
      await copyFile(sourceExecutable, partialPath);
    } else {
      const response = await fetch(pin.url, {
        redirect: "error",
        signal: AbortSignal.timeout(180_000),
      });
      if (!response.ok || !response.body) {
        throw new Error(`Node runtime download failed: HTTP ${response.status} from ${pin.url}`);
      }
      await pipeline(Readable.fromWeb(response.body), createWriteStream(partialPath, { flags: "wx" }));
    }
    await validateNodeExecutable(partialPath, pin);
    await rename(partialPath, executablePath);
    return validateNodeExecutable(executablePath, pin);
  } catch (error) {
    await rm(partialPath, { force: true }).catch(() => {});
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(process.argv[2] ?? process.cwd());
  ensureNodeRuntime(root)
    .then((runtime) => console.log(JSON.stringify(runtime, null, 2)))
    .catch((error) => {
      console.error(`Node runtime setup failed: ${error.message}`);
      process.exitCode = 1;
    });
}
