export async function startBridgeAfterDaemonStartup({ signal, startDaemon, startBridge }) {
  if (signal.aborted) return false;
  await startDaemon();
  if (signal.aborted) return false;
  startBridge();
  return true;
}
