import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { unreadMessagePixelTarget } from "./inbox-target.mjs";

const inboxTestSource = readFileSync(new URL("./inbox.test.mjs", import.meta.url), "utf8");

function inboxState({ canvasActions = ["scroll"], messageFrame = { x: 100, y: 110, w: 30, h: 20 } } = {}) {
  return {
    screenshot_width: 640,
    screenshot_height: 480,
    tree_markdown: [
      '- Window "Sophos"',
      '  - Region "Message flow canvas"',
      '    - [1] Group "Canvas scroller" [actions=[scroll]]',
      '      - Text [2] "Endpoint review approved"',
    ].join("\n"),
    elements: [
      { element_index: 1, role: "Group", label: "Canvas scroller", actions: canvasActions, frame: { x: 10, y: 20, w: 300, h: 200 } },
      { element_index: 2, role: "Text", label: "Endpoint review approved", frame: messageFrame },
    ],
  };
}

test("Inbox E2E uses the domain pixel-target helper exercised by this regression", () => {
  assert.match(inboxTestSource, /import\s*\{\s*unreadMessagePixelTarget\s*\}\s*from\s*[\"']\.\/inbox-target\.mjs[\"']/);
  assert.match(inboxTestSource, /unreadMessagePixelTarget\(clickState\)/);
  assert.match(inboxTestSource, /unreadMessagePixelTarget\(retryState\)/);
});

test("Inbox pixel target resolves the actual unread node and validated click point", () => {
  const target = unreadMessagePixelTarget(inboxState(), {
    getElementCenter: (element) => ({ x: element.frame.x + element.frame.w / 2, y: element.frame.y + element.frame.h / 2 }),
  });

  assert.equal(target.canvas.element_index, 1);
  assert.equal(target.message.label, "Endpoint review approved");
  assert.deepEqual(target.point, { x: 115, y: 120 });
});

test("Inbox pixel target fails closed when no scrollable element belongs to the canvas", () => {
  const state = inboxState({ canvasActions: [] });
  state.tree_markdown = state.tree_markdown.replace('[actions=[scroll]]', '[actions=[]]');
  state.elements[0].actions = [];

  assert.throws(
    () => unreadMessagePixelTarget(state, { getElementCenter: () => ({ x: 115, y: 120 }) }),
    /Message flow canvas did not expose its own scrollable native element/,
  );
});

test("Inbox pixel target rejects a message outside the canvas viewport or screenshot", () => {
  assert.throws(
    () => unreadMessagePixelTarget(inboxState({ messageFrame: { x: 400, y: 110, w: 30, h: 20 } }), {
      getElementCenter: () => ({ x: 415, y: 120 }),
    }),
    /outside the Message flow canvas viewport/,
  );

  assert.throws(
    () => unreadMessagePixelTarget(inboxState(), { getElementCenter: () => ({ x: 700, y: 120 }) }),
    /outside the fresh window screenshot/,
  );
});
