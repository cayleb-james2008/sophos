// promptTemplates — tests for the ⌘K palette's "Prompt Templates" feature:
// the pure CRUD helpers (promptTemplates.ts) and the composer-text bridge
// (composerTextRef.ts) that the save/insert commands rely on.

import { describe, expect, it, vi } from "vitest";
import type { PromptTemplate, Settings } from "../../../ipc/contract";
import {
  createPromptTemplate,
  addTemplate,
  removeTemplate,
  listTemplates,
  getTemplate,
} from "../promptTemplates";
import {
  getComposerText,
  setComposerText,
  subscribeComposerText,
} from "../../chat/composerTextRef";

function makeTemplate(overrides: Partial<PromptTemplate> = {}): PromptTemplate {
  return {
    id: overrides.id ?? "tpl-1",
    name: overrides.name ?? "Review",
    body: overrides.body ?? "Review this diff",
    createdAt: overrides.createdAt ?? "2026-01-01T00:00:00.000Z",
  };
}

describe("promptTemplates CRUD helpers", () => {
  it("createPromptTemplate builds a template with a unique id and ISO timestamp", () => {
    const t = createPromptTemplate("  Code review  ", "Review the PR");
    expect(t.name).toBe("Code review"); // trimmed
    expect(t.body).toBe("Review the PR");
    expect(t.id).toBeTruthy();
    expect(new Date(t.createdAt).toString()).not.toBe("Invalid Date");
  });

  it("addTemplate appends a template to the array (immutable)", () => {
    const a = makeTemplate({ id: "a" });
    const b = makeTemplate({ id: "b" });
    const next = addTemplate([a], b);
    expect(next).toHaveLength(2);
    expect(next[1]).toBe(b);
    // Original array is untouched.
    expect([a]).toHaveLength(1);
  });

  it("removeTemplate deletes by id (immutable)", () => {
    const a = makeTemplate({ id: "a" });
    const b = makeTemplate({ id: "b" });
    const next = removeTemplate([a, b], "a");
    expect(next.map((t) => t.id)).toEqual(["b"]);
    expect([a, b]).toHaveLength(2);
  });

  it("listTemplates returns templates sorted by name (case-insensitive)", () => {
    const z = makeTemplate({ id: "z", name: "Zebra" });
    const a = makeTemplate({ id: "a", name: "alpha" });
    const m = makeTemplate({ id: "m", name: "Middle" });
    const sorted = listTemplates([z, a, m]);
    expect(sorted.map((t) => t.name)).toEqual(["alpha", "Middle", "Zebra"]);
    // Original order is untouched.
    expect([z, a, m].map((t) => t.name)).toEqual(["Zebra", "alpha", "Middle"]);
  });

  it("getTemplate retrieves a template body by id (for insert)", () => {
    const a = makeTemplate({ id: "a", body: "body-a" });
    const b = makeTemplate({ id: "b", body: "body-b" });
    expect(getTemplate([a, b], "b")?.body).toBe("body-b");
    expect(getTemplate([a, b], "missing")).toBeUndefined();
  });
});

describe("composerTextRef bridge", () => {
  it("getComposerText returns the current text", () => {
    setComposerText("hello");
    expect(getComposerText()).toBe("hello");
  });

  it("setComposerText notifies subscribers with the new value", () => {
    const cb = vi.fn();
    const unsub = subscribeComposerText(cb);
    setComposerText("first");
    setComposerText("second");
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb).toHaveBeenLastCalledWith("second");
    unsub();
  });

  it("unsubscribe stops further notifications", () => {
    const cb = vi.fn();
    const unsub = subscribeComposerText(cb);
    setComposerText("one");
    unsub();
    setComposerText("two");
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("setComposerText with the same value does not re-notify", () => {
    const cb = vi.fn();
    const unsub = subscribeComposerText(cb);
    setComposerText("same");
    setComposerText("same");
    expect(cb).toHaveBeenCalledTimes(1);
    unsub();
  });
});

describe("PromptTemplate type in Settings", () => {
  it("Settings accepts a promptTemplates array of PromptTemplate", () => {
    const settings: Settings = {
      promptTemplates: [makeTemplate({ id: "t1", name: "Bug triage", body: "Triage this bug" })],
    };
    expect(settings.promptTemplates?.[0].name).toBe("Bug triage");
    expect(settings.promptTemplates?.[0].body).toBe("Triage this bug");
  });
});
