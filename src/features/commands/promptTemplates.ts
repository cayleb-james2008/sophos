// promptTemplates.ts — pure, dependency-free helpers for the ⌘K palette's
// "Prompt Templates" group. Kept free of React/IPC so the CRUD logic is
// directly unit-testable. The palette composes these with getSettings /
// setSettings to persist templates.

import type { PromptTemplate } from "../../ipc/contract";

/** Generate a unique template id (crypto.randomUUID when available). */
export function newTemplateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `tpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Build a new PromptTemplate from a name + body. */
export function createPromptTemplate(name: string, body: string): PromptTemplate {
  return {
    id: newTemplateId(),
    name: name.trim(),
    body,
    createdAt: new Date().toISOString(),
  };
}

/** Append a template to the list (immutable). */
export function addTemplate(templates: PromptTemplate[], template: PromptTemplate): PromptTemplate[] {
  return [...templates, template];
}

/** Remove a template by id (immutable). */
export function removeTemplate(templates: PromptTemplate[], id: string): PromptTemplate[] {
  return templates.filter((t) => t.id !== id);
}

/** Return templates sorted by name (case-insensitive), for stable listing. */
export function listTemplates(templates: PromptTemplate[]): PromptTemplate[] {
  return [...templates].sort((a, b) => a.name.localeCompare(b.name));
}

/** Fetch a template by id (for insert). */
export function getTemplate(templates: PromptTemplate[], id: string): PromptTemplate | undefined {
  return templates.find((t) => t.id === id);
}
