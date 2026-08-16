// sdkRenderer.test.ts — the deterministic TypeScript SDK renderer. Covers the
// bar's renderer contract:
//   * determinism — lexicographic tool order, byte-identical output for an
//     unchanged tool set (regardless of input order);
//   * degradation — unsupported/malformed schemas render permissively instead
//     of throwing;
//   * type-stripped contract — the emitted stubs are erasable TypeScript:
//     stripping types yields valid JavaScript with the same function names.

import { describe, expect, it } from "vitest";
import ts from "typescript";
import { BUILTIN_TOOLS, type ToolRegistryEntry } from "../toolRegistry";
import { renderSdk, renderStub, toIdent, toParamType, propType } from "../sdkRenderer";

const EXTRA: ToolRegistryEntry[] = [
  { name: "create_issue", description: "Create a GitHub issue", category: "extension", source: "github-integration" },
  { name: "fetch", description: "MCP tool from filesystem", category: "mcp", source: "filesystem" },
  { name: "release-audit", description: "Audit a release artifact", category: "skill", source: "project" },
];

describe("toIdent", () => {
  it("converts snake_case and spaced names to camelCase identifiers", () => {
    expect(toIdent("read_file")).toBe("readFile");
    expect(toIdent("file editor")).toBe("fileEditor");
    expect(toIdent("create_issue")).toBe("createIssue");
    expect(toIdent("web-search")).toBe("webSearch");
    expect(toIdent("run_cell")).toBe("runCell");
  });

  it("always produces a legal identifier", () => {
    expect(/^[a-z][a-zA-Z0-9]*$/.test(toIdent("1tool"))).toBe(true);
    expect(toIdent("1tool")).toBe("tool1tool");
    expect(toIdent("")).toBe("tool");
    expect(toIdent("!!!")).toBe("tool");
  });
});

describe("propType / toParamType", () => {
  it("maps schema types to TypeScript types", () => {
    expect(propType({ type: "string" })).toBe("string");
    expect(propType({ type: "number" })).toBe("number");
    expect(propType({ type: "integer" })).toBe("number");
    expect(propType({ type: "boolean" })).toBe("boolean");
    expect(propType({ type: "array", items: { type: "string" } })).toBe("Array<string>");
    expect(propType({ type: "array" })).toBe("Array<unknown>");
    expect(propType({ type: "object" })).toBe("Record<string, unknown>");
  });

  it("degrades unsupported and missing specs to unknown instead of throwing", () => {
    expect(propType(undefined)).toBe("unknown");
    expect(propType({ type: "date" })).toBe("unknown");
    expect(propType(null as unknown as undefined)).toBe("unknown");
  });

  it("renders an object contract with required and optional properties", () => {
    expect(
      toParamType({
        type: "object",
        properties: { command: { type: "string" }, cwd: { type: "string" } },
        required: ["command"],
      }),
    ).toBe("{ command: string; cwd?: string }");
  });

  it("quotes property names that aren't legal identifiers", () => {
    expect(
      toParamType({
        type: "object",
        properties: { "with-dash": { type: "string" } },
        required: [],
      }),
    ).toBe('{ "with-dash"?: string }');
  });

  it("degrades malformed schemas to a permissive contract", () => {
    expect(toParamType(undefined)).toBe("Record<string, unknown>");
    expect(toParamType({ type: "array" })).toBe("unknown");
    expect(toParamType({ type: "object", properties: "nope" as unknown as Record<string, never> })).toBe("Record<string, unknown>");
    expect(toParamType({ type: "object", properties: {} })).toBe("Record<string, unknown>");
    expect(toParamType(null as unknown as undefined)).toBe("Record<string, unknown>");
  });
});

describe("renderSdk determinism", () => {
  const entries = [...BUILTIN_TOOLS, ...EXTRA];

  it("produces byte-identical output for an unchanged tool set", () => {
    const first = renderSdk(entries);
    const second = renderSdk(entries);
    expect(second).toBe(first);
  });

  it("ignores input order — lexicographic tool order, identical bytes", () => {
    const forward = renderSdk(entries);
    const reversed = renderSdk([...entries].reverse());
    expect(reversed).toBe(forward);
  });

  it("emits stubs in lexicographic order", () => {
    const source = renderSdk(entries);
    const names = [...source.matchAll(/export async function (\w+)\(/g)].map((m) => m[1]);
    expect(names.length).toBe(entries.length);
    expect(names).toEqual([...names].sort());
  });

  it("includes every tool with its category and origin", () => {
    const source = renderSdk(entries);
    expect(source).toContain("readFile");
    expect(source).toContain("createIssue");
    expect(source).toContain("releaseAudit");
    expect(source).toContain("(builtin)");
    expect(source).toContain("(extension from github-integration)");
    expect(source).toContain("(mcp from filesystem)");
    expect(source).toContain("(skill from project)");
  });

  it("disambiguates colliding identifiers with a deterministic numeric suffix", () => {
    const colliding: ToolRegistryEntry[] = [
      { name: "read_file", category: "builtin" },
      { name: "read-file", category: "extension", source: "x" },
    ];
    const source = renderSdk(colliding);
    expect(source).toContain("readFile");
    expect(source).toContain("readFile2");
  });
});

describe("renderSdk degradation", () => {
  it("renders unsupported schemas permissively instead of throwing", () => {
    const nasty: ToolRegistryEntry[] = [
      { name: "no_schema", category: "builtin" },
      { name: "bad_schema", category: "builtin", schema: { type: "array" } },
      { name: "nasty_schema", category: "builtin", schema: { type: "object", properties: { x: { type: "date" } } } },
      { name: "quoted_key", category: "builtin", schema: { type: "object", properties: { "a-b": { type: "string" } } } },
    ];
    const source = renderSdk(nasty);
    expect(source).toContain("noSchema");
    expect(source).toContain("Record<string, unknown>");
    expect(source).toContain("unknown");
  });

  it("never throws on any tool registry entry shape", () => {
    const shapes = [
      {},
      { name: "a" },
      { name: "b", schema: null as unknown as undefined },
      { name: "c", schema: { type: "object", properties: { p: null as unknown as undefined } } },
      { name: "d", schema: { type: "object", properties: { p: { items: { type: 42 as unknown as string } } } } },
    ] as ToolRegistryEntry[];
    for (const shape of shapes) {
      expect(() => renderStub(shape, new Set())).not.toThrow();
    }
    expect(() => renderSdk(shapes)).not.toThrow();
  });
});

describe("type-stripped contract", () => {
  const entries = [...BUILTIN_TOOLS, ...EXTRA];

  it("emits only erasable syntax — stripping types yields valid JavaScript", () => {
    const source = renderSdk(entries);
    const result = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.ESNext },
      reportDiagnostics: true,
    });
    expect(result.diagnostics ?? []).toEqual([]);
    expect(result.outputText).toContain("export async function readFile");
    expect(result.outputText).toContain("export async function webSearch");
    // Erasable contract: the JS output has the same function names, no types.
    expect(result.outputText).not.toMatch(/args: \{/);
    expect(result.outputText).not.toContain(": Promise<unknown>");
  });

  it("stripTypes emits plain JavaScript directly (no annotations)", () => {
    const source = renderSdk(entries, { stripTypes: true });
    expect(source).not.toMatch(/args: /);
    expect(source).not.toContain("Promise<unknown>");
    expect(source).toContain("export async function readFile(args) {");
    // And it is valid JS.
    const result = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2021 } });
    expect(result.outputText).toContain("export async function readFile(args) {");
  });

  it("typed and stripped variants declare the same tools", () => {
    const typed = [...renderSdk(entries).matchAll(/export async function (\w+)\(/g)].map((m) => m[1]);
    const stripped = [...renderSdk(entries, { stripTypes: true }).matchAll(/export async function (\w+)\(/g)].map((m) => m[1]);
    expect(stripped).toEqual(typed);
  });
});
