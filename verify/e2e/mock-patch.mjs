// verify/e2e/mock-patch.mjs — test-only helpers that patch the MockIpcClient
// singleton at runtime to exercise paths the mock's happy-path defaults don't
// reach: a disconnected provider (login flow) and an IPC rejection (error
// handling). No src/ changes (beyond the __sophosIpc exposure) — the patch is
// injected into the running page and restored after the test.
//
// We access the singleton via window.__sophosIpc (set in getIpcClient() in
// browser/demo mode). This avoids the Vite HMR module-identity mismatch where
// `import("/src/ipc/client.ts")` resolves to a different module instance than
// the one the app loaded.

export async function patchProviderLoginFlow(page) {
  await page.evaluate(async () => {
    const ipc = window.__sophosIpc;
    if (!ipc) throw new Error("__sophosIpc not available — is this browser-demo mode?");
    if (!ipc.__orig) ipc.__orig = {};
    if (!ipc.__orig.getProviders) ipc.__orig.getProviders = ipc.getProviders.bind(ipc);
    if (!ipc.__orig.login) ipc.__orig.login = ipc.login.bind(ipc);
    let disconnected = true;
    ipc.getProviders = async function () {
      const list = await ipc.__orig.getProviders();
      return list.map((p, i) => (i === 0 ? { ...p, connected: !disconnected } : p));
    };
    ipc.login = async function (provider) {
      if (provider === "ollama-cloud") disconnected = false;
      return ipc.__orig.login(provider);
    };
  });
}

export async function patchListSessionsReject(page) {
  await page.evaluate(async () => {
    const ipc = window.__sophosIpc;
    if (!ipc) throw new Error("__sophosIpc not available — is this browser-demo mode?");
    if (!ipc.__orig) ipc.__orig = {};
    if (!ipc.__orig.listSessions) ipc.__orig.listSessions = ipc.listSessions.bind(ipc);
    ipc.listSessions = async function () {
      throw new Error("mock injected failure");
    };
  });
}

export async function restoreMock(page, methods) {
  await page.evaluate(async ({ methods }) => {
    const ipc = window.__sophosIpc;
    if (!ipc || !ipc.__orig) return;
    for (const m of methods) {
      if (ipc.__orig[m]) {
        ipc[m] = ipc.__orig[m];
      }
    }
  }, { methods });
}