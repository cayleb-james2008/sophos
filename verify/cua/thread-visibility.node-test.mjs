import test from "node:test";
import assert from "node:assert/strict";
import { composerBoundsFromElements, frameWithinVerticalBounds } from "./thread-visibility.mjs";

function frame(y, h) {
  return { x: 10, y, w: 80, h };
}

test("accepts a message fully inside the thread viewport", () => {
  assert.equal(frameWithinVerticalBounds(frame(120, 24), 100, 160), true);
});

test("rejects a message crossing the composer boundary", () => {
  assert.equal(frameWithinVerticalBounds(frame(148, 20), 100, 160), false);
});

test("rejects a message crossing the thread-header boundary", () => {
  assert.equal(frameWithinVerticalBounds(frame(96, 8), 100, 160), false);
});

test("fails closed when either viewport bound is missing or invalid", () => {
  const messageFrame = frame(120, 24);
  assert.equal(frameWithinVerticalBounds(messageFrame, undefined, 160), false);
  assert.equal(frameWithinVerticalBounds(messageFrame, 100, undefined), false);
  assert.equal(frameWithinVerticalBounds(messageFrame, "not-a-bound", 160), false);
  assert.equal(frameWithinVerticalBounds(messageFrame, 100, Number.NaN), false);
  assert.equal(frameWithinVerticalBounds(messageFrame, 160, 100), false);
});

test("fails closed when the candidate frame is missing or unusable", () => {
  assert.equal(frameWithinVerticalBounds(undefined, 100, 160), false);
  assert.equal(frameWithinVerticalBounds({ ...frame(120, 24), h: undefined }, 100, 160), false);
  assert.equal(frameWithinVerticalBounds(frame(Number.NaN, 24), 100, 160), false);
  assert.equal(frameWithinVerticalBounds(frame(120, 0), 100, 160), false);
});

test("uses the actual composer label and Send Button to establish its top bound", () => {
  const elements = [
    { role: "Text", label: "MESSAGE TO api-reviewer", frame: frame(200, 14) },
    { role: "Text", label: "⌘ ↵ TO SEND", frame: frame(200, 12) },
    { role: "Text", label: "Send", frame: frame(240, 12) },
    { role: "Button", label: "Send", frame: frame(240, 24) },
  ];
  assert.equal(composerBoundsFromElements(elements)?.top, 200);
});

test("fails closed when the composer label or actual Send Button is unavailable", () => {
  const validLabel = { role: "Text", label: "MESSAGE TO api-reviewer", frame: frame(200, 14) };
  const validButton = { role: "Button", label: "Send", frame: frame(240, 24) };
  assert.equal(composerBoundsFromElements([validButton]), undefined);
  assert.equal(composerBoundsFromElements([validLabel, { role: "Text", label: "Send", frame: frame(240, 12) }]), undefined);
  assert.equal(composerBoundsFromElements([
    { ...validLabel, frame: { ...frame(200, 14), y: Number.NaN } },
    validButton,
  ]), undefined);
  assert.equal(composerBoundsFromElements([
    validLabel,
    { ...validButton, frame: frame(210, 24) },
  ]), undefined);
});
