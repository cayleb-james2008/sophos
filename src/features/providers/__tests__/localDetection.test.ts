import { describe, expect, it, vi } from "vitest";
import { probeLocalProvider, providerApiBaseUrl } from "../localDetection";

describe("local provider setup", () => {
  it("normalizes OpenAI-compatible URLs to the API base path", () => {
    expect(providerApiBaseUrl("http://127.0.0.1:1234/")).toBe("http://127.0.0.1:1234/v1");
    expect(providerApiBaseUrl("http://localhost:1234/v1/")).toBe("http://localhost:1234/v1");
  });

  it("probes local model IDs and rejects non-loopback endpoints", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: "qwen-coder" }, { id: "qwen-coder" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(probeLocalProvider("http://127.0.0.1:1234", "openai-compatible")).resolves.toEqual([
        { id: "qwen-coder", name: "Qwen Coder" },
      ]);
      expect(fetchMock).toHaveBeenCalledWith(
        "http://127.0.0.1:1234/v1/models",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      await expect(probeLocalProvider("http://192.168.1.10:1234", "openai-compatible")).rejects.toThrow(
        /loopback URL/i,
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
