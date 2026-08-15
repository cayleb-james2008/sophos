// mock-openai.mjs — a local OpenAI-compatible chat-completions server used to
// exercise the real Sophos chat flow (send / stream / steer / abort / follow-up)
// through real IPC against a controllable model endpoint. It is NOT a real model:
// it echoes the user's message back with a streaming delay so the UI's streaming
// and abort behavior is observable and deterministic.
//
// Endpoints:
//   GET  /v1/models            -> model catalog (deepseek-v4-flash:0731-cloud)
//   POST /v1/chat/completions  -> SSE streamed chat completion (echo)
//
// Run:  node verify/cua/mock-openai.mjs [port]
import http from "node:http";

const PORT = Number(process.argv[2] || process.env.MOCK_OPENAI_PORT || 11435);
const MODEL_ID = "deepseek-v4-flash:0731-cloud";

// How long the assistant "thinks" before streaming the answer (ms). Kept short
// so tests are fast but long enough that streaming is observable.
const THINK_MS = 400;
// Delay between streamed chunks (ms).
const CHUNK_MS = 120;

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function sseChunk(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/v1/models") {
    sendJson(res, 200, {
      object: "list",
      data: [
        {
          id: MODEL_ID,
          object: "model",
          created: 0,
          owned_by: "mock",
        },
      ],
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let payload = {};
      try {
        payload = JSON.parse(body || "{}");
      } catch {
        payload = {};
      }
      const stream = payload.stream !== false;
      const userText = (payload.messages || [])
        .filter((m) => m.role === "user")
        .map((m) => (typeof m.content === "string" ? m.content : ""))
        .join(" ")
        .trim() || "(no user message)";

      if (!stream) {
        sendJson(res, 200, {
          id: "mock-cmpl",
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: payload.model || MODEL_ID,
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: `Mock reply to: ${userText}` },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        });
        return;
      }

      // Streaming response.
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      let closed = false;
      req.on("close", () => {
        closed = true;
      });

      const id = `mock-${Date.now()}`;
      const created = Math.floor(Date.now() / 1000);
      const chunk = (delta, finish) =>
        sseChunk(res, {
          id,
          object: "chat.completion.chunk",
          created,
          model: payload.model || MODEL_ID,
          choices: [
            {
              index: 0,
              delta,
              finish_reason: finish ?? null,
            },
          ],
        });

      // "Thinking" delay, then stream the echo in pieces.
      setTimeout(() => {
        if (closed) return;
        const pieces = [`Mock reply to: `, userText, ` (streamed from local mock)`];
        let i = 0;
        const timer = setInterval(() => {
          if (closed) {
            clearInterval(timer);
            return;
          }
          if (i < pieces.length) {
            chunk({ content: pieces[i] });
            i += 1;
          } else {
            chunk({}, "stop");
            res.write("data: [DONE]\n\n");
            res.end();
            clearInterval(timer);
          }
        }, CHUNK_MS);
      }, THINK_MS);
    });
    return;
  }

  sendJson(res, 404, { error: { message: `not found: ${url.pathname}` } });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`mock-openai listening on http://127.0.0.1:${PORT}`);
});
