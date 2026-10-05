import path from "node:path";

/**
 * Select the chat UI suite executable under the current checkout, preferring
 * a locally built debug exe and falling back to the CI release exe.
 */
export function resolveChatAppPath({ workspaceRoot, exists, pathImpl = path } = {}) {
  if (!workspaceRoot) throw new TypeError("workspaceRoot is required");
  if (typeof exists !== "function") throw new TypeError("exists must be a function");

  const segments = ["src-tauri", "target"];
  const debugPath = pathImpl.join(workspaceRoot, ...segments, "debug", "prime-agent-windows.exe");
  if (exists(debugPath)) return debugPath;

  return pathImpl.join(workspaceRoot, ...segments, "release", "prime-agent-windows.exe");
}
