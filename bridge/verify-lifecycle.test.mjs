import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PRIME_AGENT_PIN } from "../scripts/runtime-pins.mjs";
import { PRIME_AGENT_SECURITY_BUILD_PROVENANCE_EXPECTED } from "../scripts/prepare-prime-agent-security-build.mjs";
import { resolveLifecycleRuntime } from "./lifecycle-runtime.mjs";

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const source = await readFile(new URL("./verify-lifecycle.mjs", import.meta.url), "utf8");

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "sophos-lifecycle-layout-"));
  const put = async (path, content) => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  };
  await cp(join(repo, "scripts"), join(root, "scripts"), { recursive: true });
  for (const name of ["e2e-mock-provider.mjs", "e2e-home-cleanup.mjs", "runtime-executable.mjs"]) {
    await mkdir(join(root, "verify"), { recursive: true });
    await cp(join(repo, "verify", name), join(root, "verify", name));
  }
  await put("package.json", '{"type":"module"}');
  await put("bridge/package.json", '{"type":"module","dependencies":{"@earendil-works/pi-ai":"*"}}');
  await put("bridge/verify-lifecycle.mjs", source);
  if (existsSync(join(repo, "bridge", "lifecycle-runtime.mjs"))) {
    await cp(join(repo, "bridge", "lifecycle-runtime.mjs"), join(root, "bridge", "lifecycle-runtime.mjs"));
  }
  await cp(join(repo, "bridge", "lifecycle-cancellation.mjs"), join(root, "bridge", "lifecycle-cancellation.mjs"));
  // Compile-only copies reproduce the bundler's bridge layout: not runnable.
  await put("bridge/dist/bridge/src/connection.js", 'import "@earendil-works/pi-ai";');
  await put("bridge/node_modules/@earendil-works/pi-ai/package.json", '{"type":"module","main":"index.js"}');
  await put("bridge/node_modules/@earendil-works/pi-ai/index.js", 'import "partial-json";');
  await put("resources/.bundle-manifest.json", JSON.stringify({
    upstream: { ...PRIME_AGENT_PIN, overlay: { ...PRIME_AGENT_SECURITY_BUILD_PROVENANCE_EXPECTED,
      sourceDirectory: ".deps/prime-agent", buildDirectory: ".deps/prime-agent-security" } },
  }));
  await put("resources/daemon/package.json", '{"name":"fixture-daemon","dependencies":{"@earendil-works/pi-ai":"*"}}');
  await put("resources/daemon/dist/cli.js", "// fixture only; no daemon inference");
  await put("resources/bridge/dist/bridge/src/index.js", "// fixture entry");
  await put("resources/bridge/dist/bridge/src/connection.js", `
    import { value } from "@earendil-works/pi-ai";
    if (value !== "full-closure") throw new Error("incomplete dependency chain");
    export function isRecoverableDaemonClose(text) { return text.includes("socket closed"); }
  `);
  await put("resources/node_modules/@earendil-works/pi-ai/package.json", '{"type":"module","main":"index.js","dependencies":{"partial-json":"*"}}');
  await put("resources/node_modules/@earendil-works/pi-ai/index.js", 'export { value } from "partial-json";');
  await put("resources/node_modules/partial-json/package.json", '{"type":"module","main":"index.js","dependencies":{"fixture-leaf":"*"}}');
  await put("resources/node_modules/partial-json/index.js", 'export { value } from "fixture-leaf";');
  await put("resources/node_modules/fixture-leaf/package.json", '{"type":"module","main":"index.js"}');
  await put("resources/node_modules/fixture-leaf/index.js", 'export const value = "full-closure";');
  // Test-only child checks the actual spawned environment and contacts only the mock.
  await put("bridge/verify.mjs", `
    import assert from "node:assert/strict";
    import { readFileSync } from "node:fs";
    import { dirname, join } from "node:path";
    import { fileURLToPath } from "node:url";
    const root = dirname(dirname(fileURLToPath(import.meta.url)));
    assert.equal(process.env.REF, join(root, "resources", "daemon"));
    assert.equal(process.env.BRIDGE, join(root, "resources", "bridge", "dist", "bridge", "src", "index.js"));
    for (const key of ["ANTHROPIC_API_KEY", "NODE_OPTIONS", "DAEMON_CLI", "BRIDGE_VERIFY_SOCKET"]) assert.equal(process.env[key], undefined);
    assert.equal(process.env.PI_OFFLINE, "1");
    assert.equal(process.cwd(), process.env.HOME);
    assert.equal(process.env.USERPROFILE, process.env.HOME);
    const config = JSON.parse(readFileSync(join(process.env.HOME, ".prime", "agent", "models.json")));
    const provider = config.providers[process.env.BRIDGE_VERIFY_MODEL_PROVIDER];
    assert.equal(provider.models[0].id, process.env.BRIDGE_VERIFY_MODEL_ID);
    assert.equal(new URL(provider.baseUrl).hostname, "127.0.0.1");
    assert.equal(new URL(provider.baseUrl).protocol, "http:");
    const response = await fetch(provider.baseUrl + "/chat/completions", {
      method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + provider.apiKey },
      body: JSON.stringify({ model: process.env.BRIDGE_VERIFY_MODEL_ID, messages: [], stream: true }),
    });
    assert.equal(response.status, 200);
    console.log("FIXTURE_HOME=" + process.env.HOME);
  `);
  return root;
}

function run(root) {
  return spawnSync(process.execPath, [join(root, "bridge", "verify-lifecycle.mjs")], {
    cwd: root, encoding: "utf8", timeout: 15_000,
    env: { ...process.env, REF: "/wrong-daemon", BRIDGE: "/wrong-bridge", DAEMON_CLI: "/wrong-cli",
      NODE_OPTIONS: "", ANTHROPIC_API_KEY: "not-a-real-key", BRIDGE_VERIFY_SOCKET: "/wrong-socket" },
  });
}

test("standalone lifecycle resolves staged transitive closure, pinned REF, isolated env and cleans HOME", { skip: process.platform === "win32" && "synthetic fixture has no hash-verified bundled Node" }, async () => {
  const root = await fixture();
  try {
    const result = run(root);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /lifecycle recovery used 1 loopback/);
    const home = result.stdout.match(/FIXTURE_HOME=(.+)/)?.[1];
    assert.ok(home);
    assert.equal(existsSync(home), false, "successful isolated HOME is removed");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("staged dependency resolution fails closed instead of using an ancestor package", { skip: process.platform === "win32" && "synthetic fixture uses host Node and POSIX path semantics" }, async () => {
  const root = await fixture();
  try {
    await rm(join(root, "resources", "node_modules", "fixture-leaf"), { recursive: true, force: true });
    await mkdir(join(root, "node_modules", "fixture-leaf"), { recursive: true });
    await writeFile(join(root, "node_modules", "fixture-leaf", "package.json"), '{"type":"module","main":"index.js"}');
    await writeFile(join(root, "node_modules", "fixture-leaf", "index.js"), 'export const value = "full-closure"; console.log("UNSTAGED_ROOT_DEPENDENCY_LOADED");');
    const result = run(root);
    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /resolves outside resources\/node_modules/);
    assert.doesNotMatch(result.stdout, /UNSTAGED_ROOT_DEPENDENCY_LOADED|FIXTURE_HOME|lifecycle recovery used/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("staged bridge and daemon entry dependencies cannot fall back to project node_modules", { skip: process.platform === "win32" && "synthetic fixture uses host Node and POSIX path semantics" }, async () => {
  const root = await fixture();
  try {
    await rm(join(root, "resources", "node_modules", "@earendil-works", "pi-ai"), { recursive: true, force: true });
    await mkdir(join(root, "node_modules", "@earendil-works", "pi-ai"), { recursive: true });
    await writeFile(join(root, "node_modules", "@earendil-works", "pi-ai", "package.json"), '{"type":"module","main":"index.js"}');
    await writeFile(join(root, "node_modules", "@earendil-works", "pi-ai", "index.js"), 'export const value = "full-closure"; console.log("UNSTAGED_ROOT_DEPENDENCY_LOADED");');
    const result = run(root);
    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /@earendil-works\/pi-ai.*resolves outside resources\/node_modules/);
    assert.doesNotMatch(result.stdout, /UNSTAGED_ROOT_DEPENDENCY_LOADED|FIXTURE_HOME|lifecycle recovery used/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("standalone rejects unreviewed overlay metadata", async () => {
  const root = await fixture();
  try {
    const path = join(root, "resources", ".bundle-manifest.json");
    const manifest = JSON.parse(await readFile(path, "utf8"));
    manifest.upstream.overlay.immutableSourcePreserved = false;
    await writeFile(path, JSON.stringify(manifest));
    assert.throws(() => resolveLifecycleRuntime(root), /reviewed overlay/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("standalone refuses unpinned manifest before starting verifier or mock inference", async () => {
  const root = await fixture();
  try {
    const path = join(root, "resources", ".bundle-manifest.json");
    const manifest = JSON.parse(await readFile(path, "utf8"));
    manifest.upstream.commit = "wrong-commit";
    await writeFile(path, JSON.stringify(manifest));
    assert.throws(() => resolveLifecycleRuntime(root), /pinned Prime Agent/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("wrapper-only SIGTERM reaches its owned verifier and preserves diagnostic HOME", { skip: process.platform === "win32" && "Node child signal delivery differs on Windows" }, async () => {
  const root = await fixture();
  let childPid;
  let home;
  try {
    await writeFile(join(root, "bridge", "verify.mjs"), `
      console.log("PROBE_CHILD=" + JSON.stringify({ pid: process.pid, home: process.env.HOME }));
      process.on("SIGTERM", () => { console.log("CHILD_CLEANUP_REACHED"); process.exit(130); });
      setInterval(() => {}, 1000);
    `);
    const parent = spawn(process.execPath, [join(root, "bridge", "verify-lifecycle.mjs")], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, REF: "/wrong-daemon", BRIDGE: "/wrong-bridge", NODE_OPTIONS: "", ANTHROPIC_API_KEY: "not-a-real-key" },
    });
    let stdout = "";
    let stderr = "";
    parent.stdout.on("data", (chunk) => { stdout += chunk; });
    parent.stderr.on("data", (chunk) => { stderr += chunk; });
    const ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`verifier child readiness timed out: ${stdout}${stderr}`)), 10_000);
      timer.unref();
      parent.stdout.on("data", () => {
        const match = stdout.match(/PROBE_CHILD=(.+)/);
        if (!match) return;
        clearTimeout(timer);
        resolve(JSON.parse(match[1]));
      });
    });
    ({ pid: childPid, home } = await ready);
    const exited = once(parent, "exit");
    parent.kill("SIGTERM");
    let timeout;
    const outcome = await Promise.race([
      exited,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`lifecycle wrapper failed to stop: ${stdout}${stderr}`)), 15_000);
        timeout.unref();
      }),
    ]).finally(() => clearTimeout(timeout));
    const [code, signal] = outcome;
    assert.equal(signal, null);
    assert.equal(code, 143, `${stdout}${stderr}`);
    assert.match(stdout, /CHILD_CLEANUP_REACHED/);
    assert.match(stderr, /preserved isolated lifecycle HOME for diagnostics/);
    assert.ok(existsSync(home), "interrupted lifecycle HOME is preserved");
    assert.throws(() => process.kill(childPid, 0), "the owned verifier child must be reaped");
  } finally {
    if (home) await rm(home, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});

test("standalone fails clearly for an absent staged bundle; never falls back to compile-only copies", async () => {
  const root = await fixture();
  try {
    await rm(join(root, "resources"), { recursive: true, force: true });
    const result = run(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /bundle\.mjs/);
    assert.doesNotMatch(result.stdout, /FIXTURE_HOME/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
