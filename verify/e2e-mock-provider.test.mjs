import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  E2E_MOCK_API_KEY,
  E2E_MOCK_MODEL_ID,
  E2E_MOCK_PROVIDER_ID,
  startE2EMockProvider,
  writeE2EMockProviderConfig,
} from "./e2e-mock-provider.mjs";

test("loopback mock provider returns deterministic OpenAI-compatible SSE", async (t) => {
  const provider = await startE2EMockProvider();
  t.after(() => provider.close());

  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${E2E_MOCK_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ model: E2E_MOCK_MODEL_ID, stream: true, messages: [] }),
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);
  const body = await response.text();
  assert.match(body, /Local synthetic E2E response\./);
  assert.match(body, /data: \[DONE\]/);
  assert.equal(provider.requestCount, 1);
});

test("mock model config is written only under the isolated home and does not create auth.json", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "sophos-e2e-mock-provider-test-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const provider = await startE2EMockProvider();
  t.after(() => provider.close());

  const configPath = writeE2EMockProviderConfig(home, provider.baseUrl);
  const config = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(config.providers[E2E_MOCK_PROVIDER_ID].api, "openai-completions");
  assert.equal(config.providers[E2E_MOCK_PROVIDER_ID].models[0].id, E2E_MOCK_MODEL_ID);
  assert.equal(config.providers[E2E_MOCK_PROVIDER_ID].apiKey, E2E_MOCK_API_KEY);
  await assert.rejects(readFile(join(home, ".prime", "agent", "auth.json")), { code: "ENOENT" });
});
