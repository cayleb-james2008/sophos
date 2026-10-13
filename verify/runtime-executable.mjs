export function selectE2ENode(platform, hostExecutable, bundledWindowsExecutable) {
  return platform === "win32" ? bundledWindowsExecutable : hostExecutable;
}
