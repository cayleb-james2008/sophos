import { describe, expect, it } from "vitest";
import { BUILTIN_TOOLS } from "../toolRegistry";
import { renderSdk } from "../sdkRenderer";
import ts from "typescript";

describe("Code Intelligence and Modern Harness Tools", () => {
  it("includes all 4 code intelligence tools with valid schemas", () => {
    const astSearch = BUILTIN_TOOLS.find((t) => t.name === "ast_grep_search");
    const astOutline = BUILTIN_TOOLS.find((t) => t.name === "ast_grep_outline");
    const repomix = BUILTIN_TOOLS.find((t) => t.name === "repomix_pack");
    const repoMap = BUILTIN_TOOLS.find((t) => t.name === "code_repo_map");

    expect(astSearch).toBeDefined();
    expect(astSearch?.schema?.required).toContain("pattern");
    expect(astOutline).toBeDefined();
    expect(astOutline?.schema?.required).toContain("path");
    expect(repomix).toBeDefined();
    expect(repomix?.schema?.properties?.token_budget).toBeDefined();
    expect(repoMap).toBeDefined();
    expect(repoMap?.schema?.properties?.max_tokens).toBeDefined();
  });

  it("includes multi-tier memory tools in the built-in registry", () => {
    const search = BUILTIN_TOOLS.find((t) => t.name === "memory_search");
    const store = BUILTIN_TOOLS.find((t) => t.name === "memory_store");
    const recall = BUILTIN_TOOLS.find((t) => t.name === "memory_recall");
    const forget = BUILTIN_TOOLS.find((t) => t.name === "memory_forget");

    expect(search).toBeDefined();
    expect(store).toBeDefined();
    expect(recall).toBeDefined();
    expect(forget).toBeDefined();
  });

  it("includes durable checkpoint tools in the built-in registry", () => {
    const create = BUILTIN_TOOLS.find((t) => t.name === "create_checkpoint");
    const restore = BUILTIN_TOOLS.find((t) => t.name === "restore_checkpoint");

    expect(create).toBeDefined();
    expect(create?.schema?.required).toContain("label");
    expect(restore).toBeDefined();
    expect(restore?.schema?.required).toContain("checkpoint_id");
  });

  it("renders deterministic typed SDK stubs for all new tools", () => {
    const sdk = renderSdk(BUILTIN_TOOLS);
    expect(sdk).toContain(
      "export async function astGrepSearch(args: { lang?: string; path?: string; pattern: string }): Promise<unknown>",
    );
    expect(sdk).toContain(
      "export async function astGrepOutline(args: { lang?: string; path: string }): Promise<unknown>",
    );
    expect(sdk).toContain(
      "export async function repomixPack(args: { compress?: boolean; path?: string; token_budget?: number }): Promise<unknown>",
    );
    expect(sdk).toContain(
      "export async function codeRepoMap(args: { max_tokens?: number; path?: string }): Promise<unknown>",
    );
    expect(sdk).toContain(
      "export async function memorySearch(args: { query: string; tier?: string }): Promise<unknown>",
    );
    expect(sdk).toContain(
      "export async function memoryStore(args: { content: string; tier?: string; title: string; uri?: string }): Promise<unknown>",
    );
    expect(sdk).toContain(
      "export async function createCheckpoint(args: { label: string; summary?: string }): Promise<unknown>",
    );
    expect(sdk).toContain(
      "export async function restoreCheckpoint(args: { checkpoint_id: string }): Promise<unknown>",
    );
  });

  it("compiles cleanly into valid JavaScript when type-stripped", () => {
    const sdk = renderSdk(BUILTIN_TOOLS);
    const transpiled = ts.transpileModule(sdk, {
      compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.ESNext },
    });
    expect(transpiled.diagnostics).toEqual([]);
    expect(transpiled.outputText).toContain("export async function astGrepSearch");
    expect(transpiled.outputText).toContain("export async function memoryStore");
    expect(transpiled.outputText).toContain("export async function createCheckpoint");
  });
});
