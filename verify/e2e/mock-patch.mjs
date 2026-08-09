// verify/e2e/mock-patch.mjs — test-only helpers that patch the MockIpcClient
// prototype at runtime (via the browser's own module import) to exercise paths
// the mock's happy-path defaults don't reach: a disconnected provider (login
// flow) and an IPC rejection (error handling). No src/ changes — the patch is
// injected into the running page and restored after the test.

/**
 * Patch the mock so the first provider starts disconnected and `login`
 * reconnects it. Lets the suite drive a genuine Connect → modal → submit →
 * connected flow that the all-connected mock default can't reach.
 */
export async function patchProviderLoginFlow(page) {
  await page.evaluate(async () => {
    const mod = await import("/src/ipc/client.ts");
    const proto = mod.MockIpcClient.prototype;
    if (!proto.__orig) proto.__orig = {};
    if (!proto.__orig.getProviders) proto.__orig.getProviders = proto.getProviders;
    if (!proto.__orig.login) proto.__orig.login = proto.login;
    let disconnected = true;
    proto.getProviders = async function () {
      const list = await proto.__orig.getProviders.call(this);
      return list.map((p, i) => (i === 0 ? { ...p, connected: !disconnected } : p));
    };
    proto.login = async function (provider) {
      if (provider === "ollama-cloud") disconnected = false;
      return proto.__orig.login.call(this, provider);
    };
  });
}

/**
 * Patch the mock so `listSessions` rejects — drives the Sessions view's
 * error state + Retry recovery path.
 */
export async function patchListSessionsReject(page) {
  await page.evaluate(async () => {
    const mod = await import("/src/ipc/client.ts");
    const proto = mod.MockIpcClient.prototype;
    if (!proto.__orig) proto.__orig = {};
    if (!proto.__orig.listSessions) proto.__orig.listSessions = proto.listSessions;
    proto.listSessions = async function () {
      throw new Error("mock injected failure");
    };
  });
}

/** Restore one or more patched mock methods to their original behavior. */
export async function restoreMock(page, methods) {
  await page.evaluate(async ({ methods }) => {
    const mod = await import("/src/ipc/client.ts");
    const proto = mod.MockIpcClient.prototype;
    for (const m of methods) {
      if (proto.__orig && proto.__orig[m]) proto[m] = proto.__orig[m];
    }
  }, { methods });
}
