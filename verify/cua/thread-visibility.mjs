function usableFrame(frame) {
  return frame
    && [frame.x, frame.y, frame.w, frame.h].every(Number.isFinite)
    && frame.w > 0
    && frame.h > 0;
}

export function composerBoundsFromElements(elements) {
  const available = Array.isArray(elements) ? elements : [];
  const messageLabel = available.find((element) =>
    element?.role === "Text" && String(element.label ?? "").toLowerCase().includes("message to"),
  );
  if (!usableFrame(messageLabel?.frame)) return undefined;

  const labelTop = messageLabel.frame.y;
  const labelBottom = labelTop + messageLabel.frame.h;
  if (!Number.isFinite(labelBottom)) return undefined;
  const sendButton = available
    .filter((element) =>
      element?.role === "Button"
      && String(element.label ?? "").toLowerCase().includes("send")
      && usableFrame(element.frame)
      && element.frame.y >= labelBottom,
    )
    .sort((left, right) => left.frame.y - right.frame.y)[0];
  if (!sendButton) return undefined;

  return { top: labelTop, messageLabel, sendButton };
}

export function frameWithinVerticalBounds(frame, top, bottom) {
  if (!usableFrame(frame)) return false;
  const minY = top;
  const maxY = bottom;
  const frameTop = frame.y;
  const frameBottom = frameTop + frame.h;
  if (![minY, maxY, frameTop, frameBottom].every(Number.isFinite) || maxY <= minY) return false;
  return frameTop >= minY && frameBottom <= maxY;
}
