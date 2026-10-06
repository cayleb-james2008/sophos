import test from "node:test";
import assert from "node:assert/strict";
import { findNamedRegionScrollElement } from "./find-util.mjs";

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
