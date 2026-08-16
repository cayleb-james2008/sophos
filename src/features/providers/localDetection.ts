// Local model detection (v0.7) — automatically finds running local AI
// endpoints (Ollama, LM Studio, llama.cpp, or any OpenAI-compatible server) by
// scanning, so the user never has to type a URL. Detection runs in the
// frontend (fetch with short timeouts — the Tauri shell allows loopback
// fetches and these servers answer CORS), and the ModelSelector surfaces the
// results with friendly names + a re-scan control.

/** A model served by a detected local endpoint. */
export interface LocalDetectedModel {
  /** Raw model id as the server reports it (e.g. "deepseek-r1:8b"). */
  id: string;
  /** Friendly display name. */
  name: string;
}

export type LocalEndpointKind = "ollama" | "lm-studio" | "llama.cpp" | "openai-compatible";

/** A running local endpoint found by the scan. */
export interface LocalEndpoint {
  id: string;
  baseUrl: string;
  port: number;
  kind: LocalEndpointKind;
  /** Friendly server label, e.g. "Ollama". */
  name: string;
  models: LocalDetectedModel[];
}

/** Candidate ports for the known server families + generic OpenAI-compatible servers. */
const CANDIDATES: Array<{ port: number; kind: LocalEndpointKind }> = [
  { port: 11434, kind: "ollama" },   // Ollama default
  { port: 1234, kind: "lm-studio" }, // LM Studio default
  { port: 8080, kind: "llama.cpp" }, // llama.cpp / llama-server default
  { port: 4891, kind: "openai-compatible" }, // vLLM default
  { port: 8000, kind: "openai-compatible" },
  { port: 3000, kind: "openai-compatible" },
  { port: 3001, kind: "openai-compatible" },
  { port: 5000, kind: "openai-compatible" },
  { port: 8081, kind: "openai-compatible" },
  { port: 1337, kind: "openai-compatible" },
  { port: 9997, kind: "openai-compatible" },
  { port: 8088, kind: "openai-compatible" },
];

const SCAN_TIMEOUT_MS = 700;

/** Friendly display name for a model id (known families, else the raw id). */
export function friendlyModelName(id: string): string {
  const base = id.split(":")[0] ?? id;
  const tag = id.includes(":") ? id.split(":").slice(1).join(":") : "";
  const family = base.toLowerCase();
  let familyName = base;
  if (/^deepseek/.test(family)) familyName = base.replace(/^deepseek/i, "DeepSeek");
  else if (/^qwen/.test(family)) familyName = base.replace(/^qwen/i, "Qwen");
  else if (/^llama/.test(family)) familyName = base.replace(/^llama/i, "Llama");
  else if (/^mistral/.test(family)) familyName = base.replace(/^mistral/i, "Mistral");
  else if (/^phi[-_]?/.test(family)) familyName = base.replace(/^phi[-_]?/i, "Phi");
  else if (/^gemma/.test(family)) familyName = base.replace(/^gemma/i, "Gemma");
  else if (/^gpt/.test(family)) familyName = base.replace(/^gpt/i, "GPT");
  else if (/^codestral/.test(family)) familyName = base.replace(/^codestral/i, "Codestral");
  else if (/^llava/.test(family)) familyName = base.replace(/^llava/i, "LLaVA");
  else familyName = base;
  const pretty = familyName.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  // Common quantization tags read friendlier expanded.
  const tagPretty = tag
    .replace(/q4_k_m/g, "Q4_K_M")
    .replace(/q8_0/g, "Q8_0")
    .replace(/\b(8b|7b|3b|1b|70b|13b|32b|14b|27b|72b|110b)\b/gi, (m) => m.toUpperCase());
  return tagPretty ? `${pretty} ${tagPretty}`.trim() : pretty;
}

/** Try an Ollama-style probe on a port. Returns models or null. */
async function probeOllama(port: number): Promise<LocalDetectedModel[] | null> {
  const url = `http://127.0.0.1:${port}/api/tags`;
  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), SCAN_TIMEOUT_MS);
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    window.clearTimeout(timer);
    if (!res.ok) return null;
    const body = (await res.json()) as { models?: Array<{ name?: string; model?: string }> };
    const list = body.models ?? [];
    if (!Array.isArray(list) || list.length === 0) return [];
    return list.map((m) => {
      const id = m.name ?? m.model ?? "";
      return id ? { id, name: friendlyModelName(id) } : null;
    }).filter((m): m is LocalDetectedModel => m !== null);
  } catch {
    return null;
  }
}

/** Try an OpenAI-compatible /v1/models probe on a port. Returns models or null. */
async function probeOpenAi(port: number): Promise<LocalDetectedModel[] | null> {
  const url = `http://127.0.0.1:${port}/v1/models`;
  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), SCAN_TIMEOUT_MS);
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    window.clearTimeout(timer);
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: Array<{ id?: string }> };
    const list = body.data ?? [];
    if (!Array.isArray(list) || list.length === 0) return [];
    return list.map((m) => {
      const id = m.id ?? "";
      return id ? { id, name: friendlyModelName(id) } : null;
    }).filter((m): m is LocalDetectedModel => m !== null);
  } catch {
    return null;
  }
}

/** Probe one port with the probes matching its kind (Ollama first, then /v1). */
async function probePort(port: number, kind: LocalEndpointKind): Promise<LocalEndpoint | null> {
  const ollamaModels = await probeOllama(port);
  if (ollamaModels !== null) {
    return { id: `local-${port}`, baseUrl: `http://127.0.0.1:${port}`, port, kind: "ollama", name: "Ollama", models: ollamaModels };
  }
  const openAiModels = await probeOpenAi(port);
  if (openAiModels !== null) {
    // Refine the label when the port matches a known family.
    const kindLabel: LocalEndpointKind = kind === "llama.cpp" || kind === "lm-studio" ? kind : "openai-compatible";
    const names: Record<string, string> = {
      "llama.cpp": "llama.cpp",
      "lm-studio": "LM Studio",
      "openai-compatible": "OpenAI-compatible server",
    };
    return { id: `local-${port}`, baseUrl: `http://127.0.0.1:${port}`, port, kind: kindLabel, name: names[kindLabel], models: openAiModels };
  }
  return null;
}

/** Scan all candidate ports (bounded parallelism) and return live endpoints. */
export async function scanLocalEndpoints(): Promise<LocalEndpoint[]> {
  const results: LocalEndpoint[] = [];
  const queue = [...CANDIDATES];
  const workers = Array.from({ length: 4 }, async () => {
    while (queue.length > 0) {
      const candidate = queue.shift();
      if (!candidate) break;
      const found = await probePort(candidate.port, candidate.kind);
      if (found) results.push(found);
    }
  });
  await Promise.all(workers);
  return results.sort((a, b) => a.port - b.port);
}

/** Provider id used when selecting a model from a detected endpoint. */
export function providerIdFor(endpoint: LocalEndpoint): string {
  return endpoint.id;
}
