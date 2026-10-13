import { createServer } from "node:http";
import { once } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const E2E_MOCK_PROVIDER_ID = "sophos-e2e-mock";
export const E2E_MOCK_MODEL_ID = "sophos-e2e-model";
export const E2E_MOCK_API_KEY = "sophos-e2e-local-only";

const RESPONSE_TEXT = "Local synthetic E2E response.";
const MAX_REQUEST_BYTES = 1024 * 1024;

export async function startE2EMockProvider() {
  let requestCount = 0;
  const server = createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.writeHead(404).end();
      return;
    }
    if (request.headers.authorization !== `Bearer ${E2E_MOCK_API_KEY}`) {
      response.writeHead(401).end();
      return;
    }

    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_REQUEST_BYTES) {
        response.writeHead(413).end();
        request.destroy();
      }
    });
    request.on("end", () => {
      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        response.writeHead(400).end();
        return;
      }
      if (payload?.model !== E2E_MOCK_MODEL_ID || payload?.stream !== true) {
        response.writeHead(400).end();
        return;
      }

      requestCount += 1;
      const created = Math.floor(Date.now() / 1000);
      const base = { id: "chatcmpl-sophos-e2e", object: "chat.completion.chunk", created, model: E2E_MOCK_MODEL_ID };
      response.writeHead(200, {
        "cache-control": "no-cache",
        connection: "keep-alive",
        "content-type": "text/event-stream; charset=utf-8",
      });
      response.write(`data: ${JSON.stringify({
        ...base,
        choices: [{ index: 0, delta: { role: "assistant", content: RESPONSE_TEXT }, finish_reason: null }],
      })}\n\n`);
      response.write(`data: ${JSON.stringify({
        ...base,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      })}\n\n`);
      response.end("data: [DONE]\n\n");
    });
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise((resolve) => server.close(resolve));
    throw new Error("could not bind the E2E mock provider to a loopback port");
  }

  let closePromise;
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    get requestCount() {
      return requestCount;
    },
    close() {
      closePromise ??= new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
      return closePromise;
    },
  };
}

export function writeE2EMockProviderConfig(home, baseUrl) {
  const endpoint = new URL(baseUrl);
  if (endpoint.protocol !== "http:" || endpoint.hostname !== "127.0.0.1" || endpoint.username || endpoint.password) {
    throw new Error("E2E mock provider endpoint must be an unauthenticated loopback HTTP URL");
  }
  if (endpoint.pathname !== "/v1") throw new Error("E2E mock provider endpoint must use the /v1 API prefix");

  const modelsPath = join(home, ".prime", "agent", "models.json");
  mkdirSync(dirname(modelsPath), { recursive: true, mode: 0o700 });
  const config = {
    providers: {
      [E2E_MOCK_PROVIDER_ID]: {
        baseUrl: endpoint.toString().replace(/\/$/, ""),
        api: "openai-completions",
        apiKey: E2E_MOCK_API_KEY,
        compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
        models: [{ id: E2E_MOCK_MODEL_ID, name: "Sophos deterministic E2E fixture" }],
      },
    },
  };
  writeFileSync(modelsPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  return modelsPath;
}
