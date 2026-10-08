import test from "node:test";
import assert from "node:assert/strict";
import * as findUtil from "./find-util.mjs";

const { findNamedRegionScrollElement } = findUtil;

test("maps an unindexed named region to its indexed native scroll pane", () => {
  const state = {
    tree_markdown: [
      "- [0] Document [actions=[scroll]]",
      '  - Group "Message flow canvas"',
      "    - [34] Pane [actions=[scroll]]",
      '      - [35] Group [actions=[invoke]]',
      '        - [65] Text "Endpoint review approved" [actions=[text]]',
      '  - Group "Other region"',
      "    - [66] Pane [actions=[scroll]]",
    ].join("\n"),
    elements: [
      { element_index: 0, role: "Document", label: "", frame: { x: 0, y: 0, w: 800, h: 600 }, actions: ["scroll"] },
      { element_index: 34, role: "Pane", label: "", frame: { x: 1, y: 2, w: 3, h: 4 }, actions: ["scroll"] },
      { element_index: 65, role: "Text", label: "Endpoint review approved" },
      { element_index: 66, role: "Pane", label: "", frame: { x: 5, y: 6, w: 7, h: 8 }, actions: ["scroll"] },
    ],
  };

  assert.equal(findNamedRegionScrollElement(state, "Message flow canvas"), state.elements[1]);
});

test("prefers an indexed labeled scroll region when UIA exposes one", () => {
  const region = { element_index: 72, role: "Group", label: "Agent coordination thread", actions: ["scroll"] };
  const state = {
    tree_markdown: '- [72] Group "Agent coordination thread" [actions=[scroll]]\n  - [73] Button "Composition"',
    elements: [region, { element_index: 73, role: "Button", label: "Composition" }],
  };

  assert.equal(findNamedRegionScrollElement(state, "Agent coordination thread"), region);
});

test("maps an unindexed named region to its nearest indexed scrollable ancestor when it has no scrollable descendant", () => {
  const document = {
    element_index: 0,
    role: "Document",
    label: "",
    frame: { x: 8, y: 31, w: 1028, h: 749 },
    actions: ["scroll"],
  };
  const unrelatedSibling = {
    element_index: 8,
    role: "Group",
    label: "",
    frame: { x: 511, y: 51, w: 169, h: 11 },
    actions: ["scroll"],
  };
  const state = {
    tree_markdown: [
      "- [0] Document [actions=[scroll]]",
      "  - [8] Group [actions=[scroll]]",
      "  - [9] Group",
      '    - Group "Agent coordination thread"',
      '      - [106] Button "Composition"',
    ].join("\n"),
    elements: [document, unrelatedSibling, { element_index: 106, role: "Button", label: "Composition" }],
  };

  assert.equal(findNamedRegionScrollElement(state, "Agent coordination thread"), document);
});

test("requires the indexed UIA element to expose its scroll action", () => {
  const state = {
    tree_markdown: [
      "- [0] Document [actions=[scroll]]",
      "  - [9] Group",
      '    - Group "Agent coordination thread"',
      '      - [106] Button "Composition"',
    ].join("\n"),
    elements: [
      { element_index: 0, role: "Document", label: "", frame: { x: 8, y: 31, w: 1028, h: 749 } },
      { element_index: 106, role: "Button", label: "Composition" },
    ],
  };

  assert.equal(findNamedRegionScrollElement(state, "Agent coordination thread"), undefined);
});

test("returns undefined when the named region has no indexed scroll peer or ancestor", () => {
  const state = {
    tree_markdown: '- Group "Message flow canvas"\n  - [65] Text "Endpoint review approved"',
    elements: [{ element_index: 65, role: "Text", label: "Endpoint review approved" }],
  };

  assert.equal(findNamedRegionScrollElement(state, "Message flow canvas"), undefined);
});

test("does not select a scroll pane from a following sibling subtree", () => {
  const state = {
    tree_markdown: [
      '- Group "Named region"',
      '  - [65] Text "inside named region"',
      '- Button "Following sibling"',
      "  - [66] Pane [actions=[scroll]]",
    ].join("\n"),
    elements: [{ element_index: 66, role: "Pane", label: "", frame: { x: 1, y: 2, w: 3, h: 4 }, actions: ["scroll"] }],
  };

  assert.equal(findNamedRegionScrollElement(state, "Named region"), undefined);
});

test("resolves a pointer target from inside the named region, not the document center or a sibling", () => {
  const threadHeader = {
    element_index: 109,
    role: "Text",
    label: "THREAD / ",
    frame: { x: 830, y: 760, w: 80, h: 12 },
    actions: ["text"],
  };
  const siblingHeader = {
    element_index: 130,
    role: "Text",
    label: "THREAD / unrelated",
    frame: { x: 500, y: 760, w: 80, h: 12 },
    actions: ["text"],
  };
  const agentId = {
    element_index: 110,
    role: "Text",
    label: "RLM-1",
    frame: { x: 900, y: 760, w: 40, h: 12 },
    actions: ["text"],
  };
  const state = {
    tree_markdown: [
      "- [0] Document [actions=[scroll]]",
      '  - Group "Agent coordination thread"',
      '    - [109] Text "THREAD / " [actions=[text]]',
      '    - [110] Text "RLM-1" [actions=[text]]',
      '    - [123] Button "Composition" [actions=[expand]]',
      '  - Group "Adjacent inspector"',
      '    - [130] Text "THREAD / unrelated" [actions=[text]]',
    ].join("\n"),
    elements: [threadHeader, agentId, siblingHeader],
  };

  const pointerTarget = findUtil.findNamedRegionDescendantElement(
    state,
    "Agent coordination thread",
    { role: "Text", text: "THREAD /" },
  );
  assert.equal(pointerTarget, threadHeader);
});

test("does not resolve a matching tree descendant absent from the structured element array", () => {
  const state = {
    tree_markdown: [
      '- Group "Agent coordination thread"',
      '  - [109] Text "THREAD / " [actions=[text]]',
    ].join("\n"),
    elements: [],
  };

  assert.equal(
    findUtil.findNamedRegionDescendantElement(state, "Agent coordination thread", { role: "Text", text: "THREAD /" }),
    undefined,
  );
});

test("does not resolve a matching structured element when its named region is absent", () => {
  const state = {
    tree_markdown: [
      '- Group "Other region"',
      '  - [109] Text "THREAD / " [actions=[text]]',
    ].join("\n"),
    elements: [{ element_index: 109, role: "Text", label: "THREAD / " }],
  };

  assert.equal(
    findUtil.findNamedRegionDescendantElement(state, "Agent coordination thread", { role: "Text", text: "THREAD /" }),
    undefined,
  );
});

test("applies the requested role to indexed descendants inside the named region", () => {
  const state = {
    tree_markdown: [
      '- Group "Agent coordination thread"',
      '  - [109] Text "THREAD / " [actions=[text]]',
    ].join("\n"),
    elements: [{ element_index: 109, role: "Text", label: "THREAD / " }],
  };

  assert.equal(
    findUtil.findNamedRegionDescendantElement(state, "Agent coordination thread", { role: "Button", text: "THREAD /" }),
    undefined,
  );
});

test("applies exact-name and substring-text criteria to indexed descendants", () => {
  const state = {
    tree_markdown: [
      '- Group "Agent coordination thread"',
      '  - [109] Text "THREAD / " [actions=[text]]',
    ].join("\n"),
    elements: [{ element_index: 109, role: "Text", label: "THREAD / " }],
  };

  assert.equal(
    findUtil.findNamedRegionDescendantElement(state, "Agent coordination thread", { role: "Text", name: "different label" }),
    undefined,
  );
  assert.equal(
    findUtil.findNamedRegionDescendantElement(state, "Agent coordination thread", { role: "Text", text: "does not occur" }),
    undefined,
  );
});
