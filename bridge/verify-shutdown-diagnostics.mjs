function appendTrace(trace, entry) {
  try {
    trace.push(entry);
  } catch {
    // Evidence collection must never block the original RPC.
  }
}

function safeTimestamp(now) {
  try {
    return now();
  } catch {
    return new Date().toISOString();
  }
}

export function safeDiagnosticError(error) {
  try {
    const isError = error instanceof Error;
    const details = {
      error: String(isError ? error.message : error),
      name: isError ? String(error.name) : typeof error,
    };
    if (isError && typeof error.stack === "string") details.stack = error.stack;
    return details;
  } catch {
    return { error: "<unprintable thrown value>", name: "unknown" };
  }
}

export function traceShutdownRpc(client, trace, now = () => new Date().toISOString()) {
  if (!client || typeof client.request !== "function" || !Array.isArray(trace) || typeof now !== "function") {
    throw new TypeError("shutdown RPC tracing requires a request client, trace array, and clock");
  }

  const originalRequest = client.request;
  const previousDescriptor = Object.getOwnPropertyDescriptor(client, "request");
  const tracedRequest = async function (command, ...args) {
    if (command?.type !== "shutdown") return originalRequest.apply(this, [command, ...args]);

    appendTrace(trace, { event: "shutdown_rpc_request", at: safeTimestamp(now), command });
    try {
      const response = await originalRequest.apply(this, [command, ...args]);
      appendTrace(trace, { event: "shutdown_rpc_response", at: safeTimestamp(now), response });
      return response;
    } catch (error) {
      appendTrace(trace, {
        event: "shutdown_rpc_error",
        at: safeTimestamp(now),
        ...safeDiagnosticError(error),
      });
      throw error;
    }
  };
  Object.defineProperty(client, "request", {
    configurable: true,
    enumerable: previousDescriptor?.enumerable ?? false,
    writable: true,
    value: tracedRequest,
  });

  return () => {
    if (client.request !== tracedRequest) return;
    if (previousDescriptor) Object.defineProperty(client, "request", previousDescriptor);
    else delete client.request;
  };
}
