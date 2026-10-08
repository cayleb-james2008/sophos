import { assert } from "./assertions.mjs";
import { elementCenter } from "./helpers.mjs";
import { findBy, findNamedRegionScrollElement } from "./find-util.mjs";

/** Resolve and validate the unread Inbox message's pixel-click target. */
export function unreadMessagePixelTarget(state, { getElementCenter = elementCenter } = {}) {
  const canvas = findNamedRegionScrollElement(state, "Message flow canvas", { allowAncestors: false });
  assert(canvas, "Message flow canvas did not expose its own scrollable native element");
  const message = findBy(state, { text: "Endpoint review approved" });
  assert(message, "Unread message node not found in fresh click state");
  assert(canvas.frame && message.frame, "Expected native frames for canvas and unread message");
  const canvasRight = canvas.frame.x + canvas.frame.w;
  const canvasBottom = canvas.frame.y + canvas.frame.h;
  const messageRight = message.frame.x + message.frame.w;
  const messageBottom = message.frame.y + message.frame.h;
  assert(
    message.frame.x >= canvas.frame.x && message.frame.y >= canvas.frame.y &&
      messageRight <= canvasRight && messageBottom <= canvasBottom,
    "Unread message frame is outside the Message flow canvas viewport",
  );
  const point = getElementCenter(message, state);
  assert(
    point.x >= 0 && point.y >= 0 && point.x < state.screenshot_width && point.y < state.screenshot_height,
    "Unread message click point is outside the fresh window screenshot",
  );
  return { canvas, message, point };
}
