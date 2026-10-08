export const LIFECYCLE_CANCEL_MESSAGE = "sophos.lifecycle.cancel";

export function isLifecycleCancellationMessage(message) {
  return message?.type === LIFECYCLE_CANCEL_MESSAGE
    && (message.signal === "SIGINT" || message.signal === "SIGTERM");
}

export function requestLifecycleCancellation(child, signal, platform = process.platform) {
  if (platform !== "win32") return child.kill(signal);
  if (!child.connected || typeof child.send !== "function") return false;
  try {
    child.send({ type: LIFECYCLE_CANCEL_MESSAGE, signal });
    return true;
  } catch {
    return false;
  }
}
