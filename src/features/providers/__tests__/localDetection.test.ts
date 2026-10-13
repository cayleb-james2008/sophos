import { describe, expect, it, vi } from "vitest";
import { probeLocalProvider, providerApiBaseUrl, scanLocalEndpoints } from "../localDetection";

function jsonResponse(value: unknown): Response {
  const bytes = new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value));
  let read = false;
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: {
      getReader: () => ({
        read: async () => {
          if (read) return { done: true, value: undefined };
          read = true;
          return { done: false, value: bytes };
        },
        releaseLock: () => undefined,
        cancel: async () => undefined,
      }),
    },
  } as unknown as Response;
}

describe("local provider setup", () => {
  it("normalizes OpenAI-compatible URLs to the API base path", () => {
    expect(providerApiBaseUrl("http://127.0.0.1:1234/")).toBe("http://127.0.0.1:1234/v1");
    expect(providerApiBaseUrl("http://localhost:1234/v1/")).toBe("http://localhost:1234/v1");
  });

  it("probes local model IDs and rejects non-loopback endpoints", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: [{ id: "qwen-coder" }, { id: "qwen-coder" }] }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(probeLocalProvider("http://127.0.0.1:1234", "openai-compatible")).resolves.toEqual([
        { id: "qwen-coder", name: "Qwen Coder" },
      ]);
      expect(fetchMock).toHaveBeenCalledWith(
        "http://127.0.0.1:1234/v1/models",
        expect.objectContaining({ signal: expect.any(AbortSignal), redirect: "error" }),
      );
      await expect(probeLocalProvider("http://192.168.1.10:1234", "openai-compatible")).rejects.toThrow(
        /loopback URL/i,
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("refuses redirects during automatic loopback discovery", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("redirect blocked"));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(scanLocalEndpoints()).resolves.toEqual([]);
      expect(fetchMock).toHaveBeenCalled();
      expect(fetchMock.mock.calls.every(([, options]) => options.redirect === "error")).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("ignores malformed model IDs and rejects oversized catalogs", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ data: [{ id: { nested: "not a model id" } }, { id: "qwen-coder" }] }),
      );
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(probeLocalProvider("http://127.0.0.1:1234", "openai-compatible")).resolves.toEqual([
        { id: "qwen-coder", name: "Qwen Coder" },
      ]);
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ data: Array.from({ length: 513 }, (_, index) => ({ id: `m${index}` })) }),
      );
      await expect(probeLocalProvider("http://127.0.0.1:1234", "openai-compatible")).rejects.toThrow(
        /excessive row/i,
      );
      fetchMock.mockResolvedValueOnce(jsonResponse(" ".repeat(1024 * 1024 + 1)));
      await expect(probeLocalProvider("http://127.0.0.1:1234", "openai-compatible")).rejects.toThrow(
        /too large/i,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
