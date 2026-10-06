// composition-wheel-probe.mjs — native Windows A/B probe for the pinned CUA wheel path.
//
// Four isolated trials separate two factors one at a time:
//   A: the pinned-driver wheel as-is vs the same wheel preceded by one extra
//      native MOUSEEVENTF_MOVE event; SetCursorPos is the shared precondition.
//   B: the existing lower-edge UIA point vs the visible thread viewport center.
// Each trial resets Chat -> Agents, records UIA geometry, saves before/after PNGs,
// and records the exact foreground wheel response. The regular blocking CUA suite
// still runs afterward and retains its visibility, click, and panel assertions.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { afterAll, runDemoSuite } from "./demo-runner.mjs";
import {
  DRIVER_BIN,
  bringToFront,
  getWindowState,
  listWindows,
  scroll,
  sleep,
} from "./driver.mjs";
import {
  elementCenter,
  navTo,
  SCREENSHOT_DIR,
  toWindowLocal,
} from "./helpers.mjs";
import {
  findBy,
  findNamedRegionDescendantElement,
  findNamedRegionScrollElement,
  findRightmost,
  waitFor,
} from "./find-util.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const NATIVE_INPUT_SCRIPT = join(__dirname, "send-input-move.ps1");
const REPORT_PATH = join(SCREENSHOT_DIR, "composition-wheel-probe.json");
const SCROLL_DIRECTION = "down";
const SCROLL_TICKS = 5;
const TITLE_BAR_HEIGHT = 30;
const BORDER_RGB = [63, 61, 56];
const BORDER_TOLERANCE = 8;
const MIN_DIVIDER_RUN = 180;
const DETAIL_ACTIONS_BOTTOM_PADDING_PX = 12;

const CONDITIONS = [
  { id: "no-move-lower-edge", explicitMove: false, point: "lower-edge" },
  { id: "move-lower-edge", explicitMove: true, point: "lower-edge" },
  { id: "no-move-center", explicitMove: false, point: "center" },
  { id: "move-center", explicitMove: true, point: "center" },
];

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function finiteFrame(element) {
  const frame = element?.frame;
  return Boolean(frame) &&
    Number.isFinite(Number(frame.x)) && Number.isFinite(Number(frame.y)) &&
    Number.isFinite(Number(frame.w)) && Number.isFinite(Number(frame.h)) &&
    Number(frame.w) > 0 && Number(frame.h) > 0;
}

function windowLocalBounds(element, windowState) {
  if (!finiteFrame(element)) return null;
  const frame = element.frame;
  const left = toWindowLocal(Number(frame.x), Number(frame.y), windowState);
  const right = toWindowLocal(Number(frame.x) + Number(frame.w), Number(frame.y) + Number(frame.h), windowState);
  return { x: left.x, y: left.y, right: right.x, bottom: right.y };
}

function boundsInsideScreenshot(bounds, width, height) {
  return Boolean(bounds) && bounds.x >= 0 && bounds.y >= 0 &&
    bounds.right <= width && bounds.bottom <= height;
}

function describeElement(element, windowState) {
  if (!element) return null;
  return {
    element_index: element.element_index ?? null,
    role: element.role ?? null,
    label: element.label ?? null,
    frame: element.frame ?? null,
    windowLocalBounds: windowLocalBounds(element, windowState),
    actions: element.actions ?? [],
  };
}

function nativeTreeSnippet(state, label) {
  const lines = String(state?.tree_markdown ?? "").split(/\r?\n/);
  const index = lines.findIndex((line) => line.includes(label));
  return index < 0 ? [] : lines.slice(Math.max(0, index - 1), Math.min(lines.length, index + 9));
}

function colorAt(image, x, y) {
  const offset = (y * image.width + x) * 4;
  return [image.data[offset], image.data[offset + 1], image.data[offset + 2]];
}

function isBorderColor(rgb) {
  return rgb.every((value, index) => Math.abs(value - BORDER_RGB[index]) <= BORDER_TOLERANCE);
}

function dividerRuns(image, y, headerCenterX) {
  const runs = [];
  let start = -1;
  for (let x = 0; x < image.width; x += 1) {
    if (isBorderColor(colorAt(image, x, y))) {
      if (start < 0) start = x;
    } else if (start >= 0) {
      const end = x;
      if (end - start >= MIN_DIVIDER_RUN && headerCenterX >= start - 2 && headerCenterX <= end + 2) {
        runs.push({ start, end, length: end - start });
      }
      start = -1;
    }
  }
  if (start >= 0) {
    const end = image.width;
    if (end - start >= MIN_DIVIDER_RUN && headerCenterX >= start - 2 && headerCenterX <= end + 2) {
      runs.push({ start, end, length: end - start });
    }
  }
  return runs;
}

/**
 * The named region is an unindexed Group, not a bounds-bearing element. Anchor
 * its horizontal bounds to the pane divider in the screenshot; the divider is
 * the top of .ag-detail__actions, not the thread viewport. The actual scroll
 * viewport begins after the rightmost Attach button plus the CSS 12px bottom
 * padding on .ag-detail__actions. Its bottom is clipped by the screenshot.
 * The indexed THREAD header must fall inside that geometry; otherwise fail.
 */
function detectVisibleThreadViewport(state, headerElement, attachElement, screenshotPath) {
  const image = PNG.sync.read(readFileSync(screenshotPath));
  requireCondition(
    image.width === state.screenshot_width && image.height === state.screenshot_height,
    `Screenshot dimensions disagree with fresh UIA state (${image.width}x${image.height} vs ${state.screenshot_width}x${state.screenshot_height})`,
  );
  const headerBounds = windowLocalBounds(headerElement, state);
  const attachBounds = windowLocalBounds(attachElement, state);
  requireCondition(boundsInsideScreenshot(headerBounds, image.width, image.height),
    `THREAD header UIA bounds are outside the screenshot (${JSON.stringify(headerBounds)})`);
  requireCondition(boundsInsideScreenshot(attachBounds, image.width, image.height),
    `Rightmost Attach button UIA bounds are outside the screenshot (${JSON.stringify(attachBounds)})`);
  const headerCenterX = (headerBounds.x + headerBounds.right) / 2;
  const headerTop = Math.floor(headerBounds.y);
  const firstRow = Math.max(0, headerTop - 180);
  let divider = null;
  for (let y = firstRow; y < headerTop; y += 1) {
    for (const run of dividerRuns(image, y, headerCenterX)) {
      if (!divider || y > divider.y || (y === divider.y && run.length > divider.run.length)) {
        divider = { y, run };
      }
    }
  }
  requireCondition(divider, "Could not identify the visible detail-pane/action divider above the UIA THREAD header");

  const bounds = {
    left: divider.run.start,
    top: Math.ceil(attachBounds.bottom + DETAIL_ACTIONS_BOTTOM_PADDING_PX),
    right: divider.run.end,
    bottom: image.height,
  };
  requireCondition(bounds.top > divider.y && bounds.right > bounds.left && bounds.bottom > bounds.top,
    `Visible thread viewport bounds are degenerate (${JSON.stringify({ bounds, dividerY: divider.y, attachBounds })})`);
  const headerCenterY = (headerBounds.y + headerBounds.bottom) / 2;
  requireCondition(
    headerCenterX >= bounds.left && headerCenterX < bounds.right &&
      headerCenterY >= bounds.top && headerCenterY < bounds.bottom,
    `UIA THREAD header is not inside the UIA/screenshot-derived viewport (${JSON.stringify({ bounds, headerBounds, attachBounds })})`,
  );
  requireCondition(headerBounds.y - bounds.top >= 10 && headerBounds.y - bounds.top <= 55,
    `THREAD header is not near the start of the computed scroll viewport (${JSON.stringify({ bounds, headerBounds })})`);
  const center = {
    x: Math.round((bounds.left + bounds.right) / 2),
    y: Math.round((bounds.top + bounds.bottom) / 2),
  };
  const lowerEdge = elementCenter(headerElement, state);
  requireCondition(center.x > bounds.left + 20 && center.x < bounds.right - 20 &&
    center.y > bounds.top + 20 && center.y < bounds.bottom - 20,
  `Computed viewport center is not well inside the visible region (${JSON.stringify({ bounds, center })})`);
  requireCondition(lowerEdge.x >= bounds.left && lowerEdge.x < bounds.right &&
    lowerEdge.y >= bounds.top && lowerEdge.y < bounds.bottom,
  `Existing UIA lower-edge point is outside the visible thread viewport (${JSON.stringify({ bounds, lowerEdge })})`);
  requireCondition(bounds.bottom - lowerEdge.y <= Math.max(30, Math.ceil((bounds.bottom - bounds.top) * 0.25)),
    `Existing UIA point is not near the viewport's lower edge (${JSON.stringify({ bounds, lowerEdge })})`);

  return {
    bounds,
    center,
    lowerEdge,
    lowerEdgeDistanceToBottom: bounds.bottom - lowerEdge.y,
    visibleTopDivider: {
      role: "detail actions border-top; horizontal bounds only",
      rowY: divider.y,
      rgb: colorAt(image, divider.run.start, divider.y),
      pixelRun: { left: divider.run.start, rightExclusive: divider.run.end, length: divider.run.length },
    },
    rightmostAttachButton: { bounds: attachBounds, frame: attachElement.frame },
    threadViewportTopDerivation: {
      formula: "ceil(Attach UIA bottom + .ag-detail__actions CSS padding-bottom)",
      cssPaddingBottomPixels: DETAIL_ACTIONS_BOTTOM_PADDING_PX,
    },
    source: "UIA Attach bounds + CSS actions padding + screenshot pane divider/viewport clip + UIA THREAD header bounds",
  };
}

function toScreenPoint(windowLocalPoint, state) {
  const window = listWindows({ pid: state.pid }).find((item) => item.window_id === state.window_id);
  requireCondition(window?.bounds && Number.isFinite(Number(window.bounds.x)) &&
    Number.isFinite(Number(window.bounds.y)) && Number.isFinite(Number(window.bounds.width)) &&
    Number.isFinite(Number(window.bounds.height)),
  "Could not resolve native window bounds for the local-to-screen coordinate conversion");
  const originX = Number(window.bounds.x) + (Number(window.bounds.width) - state.screenshot_width) / 2;
  const originY = Number(window.bounds.y) + (Number(window.bounds.height) - state.screenshot_height) / 2;
  return { x: Math.round(originX + windowLocalPoint.x), y: Math.round(originY + windowLocalPoint.y) };
}

function screenshotRecord(path, state) {
  requireCondition(existsSync(path), `Expected screenshot was not written: ${path}`);
  const bytes = readFileSync(path);
  requireCondition(bytes.length > 0, `Screenshot is empty: ${path}`);
  const png = PNG.sync.read(bytes);
  requireCondition(png.width === state.screenshot_width && png.height === state.screenshot_height,
    `Screenshot file dimensions do not match UIA state for ${path}`);
  return {
    path: `verify/cua/screenshots/${basename(path)}`,
    bytes: bytes.length,
    sha256: sha256(bytes),
    width: png.width,
    height: png.height,
  };
}

function imageDifference(beforePath, afterPath) {
  const before = PNG.sync.read(readFileSync(beforePath));
  const after = PNG.sync.read(readFileSync(afterPath));
  requireCondition(before.width === after.width && before.height === after.height,
    "Before/after screenshot dimensions changed within a trial");
  const diff = new PNG({ width: before.width, height: before.height });
  const entireFramePixels = pixelmatch(before.data, after.data, diff.data, before.width, before.height, {
    threshold: 0.1,
    includeAA: false,
  });
  let appContentPixels = 0;
  let minX = before.width;
  let minY = before.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = TITLE_BAR_HEIGHT; y < before.height; y += 1) {
    for (let x = 0; x < before.width; x += 1) {
      const offset = (y * before.width + x) * 4;
      if (
        before.data[offset] !== after.data[offset] ||
        before.data[offset + 1] !== after.data[offset + 1] ||
        before.data[offset + 2] !== after.data[offset + 2]
      ) {
        appContentPixels += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  return {
    entireFramePixelmatchCount: entireFramePixels,
    appContentExactRgbChangedPixels: appContentPixels,
    appContentDifferenceBounds: maxX < 0 ? null : [minX, minY, maxX + 1, maxY + 1],
    appContentRegionStartsAtY: TITLE_BAR_HEIGHT,
  };
}

function runNativeInput(mode, point) {
  const args = ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", NATIVE_INPUT_SCRIPT, "-Mode", mode];
  if (point) args.push("-X", String(point.x), "-Y", String(point.y));
  const result = spawnSync("pwsh", args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 10_000,
  });
  if (result.error) throw new Error(`PowerShell native input helper ${mode} failed to start: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`PowerShell native input helper ${mode} exited ${result.status}: ${(result.stderr || result.stdout).trim()}`);
  }
  const output = String(result.stdout ?? "").trim();
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch (error) {
    throw new Error(`PowerShell native input helper ${mode} returned invalid JSON: ${output}`, { cause: error });
  }
  return parsed;
}

function driverVersion() {
  const result = spawnSync(DRIVER_BIN, ["--version"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 5_000,
  });
  if (result.error) throw new Error(`Pinned cua-driver version query failed: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`Pinned cua-driver --version exited ${result.status}: ${(result.stderr || result.stdout).trim()}`);
  }
  const output = `${String(result.stdout ?? "").trim()}${result.stderr ? ` ${String(result.stderr).trim()}` : ""}`.trim();
  requireCondition(/\b0\.34\.0\b/.test(output), `Expected cua-driver-rs v0.34.0, received ${JSON.stringify(output)}`);
  return output;
}

function persistReport(report) {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

async function resetToAgents(appHandle) {
  const initial = getWindowState(appHandle.pid, appHandle.windowId, { include_screenshot: false });
  navTo(appHandle.pid, initial, "Chat");
  await sleep(400);
  const chat = getWindowState(appHandle.pid, appHandle.windowId, { include_screenshot: false });
  navTo(appHandle.pid, chat, "Agents");
  requireCondition(await waitFor(chat, { text: "AGENT FLEET" }, 8_000), "Agents view did not render after Chat -> Agents reset");
  await sleep(800);
}

function compareTrial(trial) {
  const beforeY = trial.before?.composition?.windowLocalBounds?.y;
  const afterY = trial.after?.composition?.windowLocalBounds?.y;
  return {
    trial: trial.id,
    explicitMove: trial.explicitMove,
    point: trial.point,
    compositionMovedUpPixels: Number.isFinite(beforeY) && Number.isFinite(afterY) ? beforeY - afterY : null,
    compositionVisibleAfter: trial.after?.composition?.fullyInsideScreenshot ?? null,
    appContentExactRgbChangedPixels: trial.pixelDifference?.appContentExactRgbChangedPixels ?? null,
    driverEffect: trial.scrollResult?.effect ?? null,
    driverRoute: trial.scrollResult?.route ?? null,
    inputDelivered: trial.inputDelivered ?? false,
  };
}

function pairedComparison(report, firstId, secondId) {
  const first = report.trials.find((trial) => trial.id === firstId);
  const second = report.trials.find((trial) => trial.id === secondId);
  const firstReadback = first ? compareTrial(first) : null;
  const secondReadback = second ? compareTrial(second) : null;
  return {
    fixedVariable: first && second ? {
      explicitMove: first.explicitMove === second.explicitMove,
      point: first.point === second.point,
    } : null,
    first: firstReadback,
    second: secondReadback,
  };
}

async function runTrial(appHandle, condition, report) {
  const trial = {
    id: condition.id,
    explicitMove: condition.explicitMove,
    point: condition.point,
    requested: { delivery_mode: "foreground", direction: SCROLL_DIRECTION, amount: SCROLL_TICKS },
    errors: [],
    inputDelivered: false,
  };
  const beforePath = join(SCREENSHOT_DIR, `composition-wheel-${condition.id}-before.png`);
  const afterPath = join(SCREENSHOT_DIR, `composition-wheel-${condition.id}-after.png`);
  let beforeState = null;
  let afterState = null;
  let originalCursor = null;

  try {
    await resetToAgents(appHandle);
    beforeState = getWindowState(appHandle.pid, appHandle.windowId, {
      include_screenshot: true,
      screenshot_out_file: beforePath,
    });
    const compositionBefore = findBy(beforeState, { text: "Composition" });
    requireCondition(compositionBefore, "Composition control is missing from the fresh before-scroll UIA snapshot");
    requireCondition(finiteFrame(compositionBefore), "Composition control has no native UIA bounds before scrolling");
    const compositionBeforeBounds = windowLocalBounds(compositionBefore, beforeState);
    requireCondition(!boundsInsideScreenshot(compositionBeforeBounds, beforeState.screenshot_width, beforeState.screenshot_height),
      `Composition control is already fully visible before the trial (${JSON.stringify(compositionBeforeBounds)})`);

    const nativeTree = String(beforeState.tree_markdown ?? "");
    requireCondition(nativeTree.split(/\r?\n/).some((line) =>
      /^\s*-\s+(?:\[\d+\]\s+)?(?:Group|Pane|Region)\s+"Agent coordination thread"(?:\s|$)/.test(line)),
    "Agent coordination thread region is missing from the native UIA tree");
    const scrollTarget = findNamedRegionScrollElement(beforeState, "Agent coordination thread");
    requireCondition(scrollTarget && finiteFrame(scrollTarget), "Agent coordination thread has no indexed native scroll target with bounds");
    const headerElement = findNamedRegionDescendantElement(beforeState, "Agent coordination thread", {
      role: "Text",
      text: "THREAD /",
    });
    requireCondition(headerElement && finiteFrame(headerElement), "Agent coordination thread has no indexed THREAD header with UIA bounds");
    const attachButton = findRightmost(beforeState, { text: "Attach" });
    requireCondition(attachButton && finiteFrame(attachButton), "Agent detail has no rightmost Attach button with UIA bounds");
    const geometry = detectVisibleThreadViewport(beforeState, headerElement, attachButton, beforePath);
    const localPoint = condition.point === "center" ? geometry.center : geometry.lowerEdge;
    requireCondition(localPoint.x >= 0 && localPoint.y >= 0 &&
      localPoint.x < beforeState.screenshot_width && localPoint.y < beforeState.screenshot_height,
    `Trial hit point is outside the window screenshot (${JSON.stringify(localPoint)})`);
    const screenPoint = toScreenPoint(localPoint, beforeState);
    trial.viewportGeometry = geometry;
    trial.pointWindowLocal = localPoint;
    trial.pointScreen = screenPoint;
    trial.before = {
      screenshot: screenshotRecord(beforePath, beforeState),
      composition: {
        ...describeElement(compositionBefore, beforeState),
        fullyInsideScreenshot: boundsInsideScreenshot(compositionBeforeBounds, beforeState.screenshot_width, beforeState.screenshot_height),
      },
      scrollActionTarget: describeElement(scrollTarget, beforeState),
      threadHeader: describeElement(headerElement, beforeState),
      detailAttachButton: describeElement(attachButton, beforeState),
      nativeScrollTargets: (beforeState.elements ?? [])
        .filter((element) => Array.isArray(element.actions) && element.actions.includes("scroll"))
        .map((element) => describeElement(element, beforeState)),
      screenshotDimensions: { width: beforeState.screenshot_width, height: beforeState.screenshot_height },
      nativeTreeSnippet: nativeTreeSnippet(beforeState, "Agent coordination thread"),
    };

    const cursorState = runNativeInput("get");
    requireCondition(Number.isInteger(cursorState.x) && Number.isInteger(cursorState.y),
      `Native cursor query returned invalid coordinates (${JSON.stringify(cursorState)})`);
    originalCursor = { x: cursorState.x, y: cursorState.y };
    trial.originalCursorScreen = originalCursor;

    await sleep(350);
    const activation = bringToFront(appHandle.pid, appHandle.windowId);
    trial.activation = activation;
    requireCondition(activation?.landed_on_target === true && activation?.target_hwnd === activation?.now_fg_hwnd,
      `Sophos was not confirmed foreground before the wheel (${JSON.stringify(activation)})`);

    const pointerPosition = runNativeInput("position", screenPoint);
    trial.pointerPositionResult = pointerPosition;
    requireCondition(pointerPosition?.positioned === true &&
      pointerPosition?.screenX === screenPoint.x && pointerPosition?.screenY === screenPoint.y &&
      pointerPosition?.actualScreenX === screenPoint.x && pointerPosition?.actualScreenY === screenPoint.y,
    `Shared SetCursorPos precondition failed (${JSON.stringify(pointerPosition)})`);

    if (condition.explicitMove) {
      const moveResult = runNativeInput("move", screenPoint);
      trial.explicitMoveResult = moveResult;
      requireCondition(moveResult?.sendInputCount === 1 &&
        moveResult?.actualScreenX === screenPoint.x && moveResult?.actualScreenY === screenPoint.y &&
        moveResult?.eventFlags === "MOUSEEVENTF_MOVE|MOUSEEVENTF_ABSOLUTE|MOUSEEVENTF_VIRTUALDESK",
      `Explicit native MOUSEEVENTF_MOVE was not inserted exactly once (${JSON.stringify(moveResult)})`);
    }

    const scrollResult = scroll(appHandle.pid, SCROLL_DIRECTION, SCROLL_TICKS, appHandle.windowId, {
      x: localPoint.x,
      y: localPoint.y,
      delivery_mode: "foreground",
    });
    trial.scrollResult = scrollResult;
    trial.inputDelivered = scrollResult?.delivery?.mode === "foreground" &&
      scrollResult?.route === "global_input" &&
      /SendInput wheel/i.test(String(scrollResult?.summary ?? ""));
    requireCondition(trial.inputDelivered,
      `Pinned foreground SendInput wheel delivery was not confirmed (${JSON.stringify(scrollResult)})`);
  } catch (error) {
    trial.errors.push(String(error?.stack ?? error));
  } finally {
    if (originalCursor) {
      try {
        trial.cursorRestore = runNativeInput("restore", originalCursor);
        requireCondition(trial.cursorRestore?.restored === true &&
          trial.cursorRestore?.actualX === originalCursor.x && trial.cursorRestore?.actualY === originalCursor.y,
        `Native cursor did not return to its original position (${JSON.stringify(trial.cursorRestore)})`);
      } catch (error) {
        trial.errors.push(`Cursor restore failed: ${String(error?.stack ?? error)}`);
      }
    }
    if (beforeState) {
      try {
        await sleep(350);
        afterState = getWindowState(appHandle.pid, appHandle.windowId, {
          include_screenshot: true,
          screenshot_out_file: afterPath,
        });
        const compositionAfter = findBy(afterState, { text: "Composition" });
        requireCondition(compositionAfter && finiteFrame(compositionAfter),
          "Composition control is missing or has invalid UIA bounds in the fresh after-scroll snapshot");
        const compositionAfterBounds = windowLocalBounds(compositionAfter, afterState);
        trial.after = {
          screenshot: screenshotRecord(afterPath, afterState),
          composition: {
            ...describeElement(compositionAfter, afterState),
            fullyInsideScreenshot: boundsInsideScreenshot(compositionAfterBounds, afterState.screenshot_width, afterState.screenshot_height),
          },
          screenshotDimensions: { width: afterState.screenshot_width, height: afterState.screenshot_height },
          nativeTreeSnippet: nativeTreeSnippet(afterState, "Agent coordination thread"),
        };
      } catch (error) {
        trial.errors.push(`After-state capture failed: ${String(error?.stack ?? error)}`);
      }
    }
  }

  if (beforeState && afterState) {
    try {
      trial.pixelDifference = imageDifference(beforePath, afterPath);
    } catch (error) {
      trial.errors.push(`Pixel evidence failed: ${String(error?.stack ?? error)}`);
    }
  }
  report.trials.push(trial);
  persistReport(report);
  console.log("[COMPOSITION-WHEEL-AB-TRIAL]", JSON.stringify(trial));
  return trial;
}

const tests = [
  {
    name: "Composition wheel A/B diagnostic captures all four one-factor contrasts",
    fn: async (appHandle) => {
      const version = driverVersion();
      const report = {
        schemaVersion: 1,
        capturedAt: new Date().toISOString(),
        status: "collecting",
        driver: {
          binary: basename(DRIVER_BIN),
          path: DRIVER_BIN,
          versionOutput: version,
          expectedRelease: "cua-driver-rs-v0.34.0",
        },
        target: {
          pid: appHandle.pid,
          windowId: appHandle.windowId,
          initialHeadProvidedByWorkflow: process.env.GITHUB_SHA ?? null,
        },
        variablePlan: {
          A: "same confirmed SetCursorPos precondition in every arm; pinned-driver wheel with vs without one additional native MOUSEEVENTF_MOVE event",
          B: "screen point at the rightmost Attach button-derived viewport center vs existing UIA THREAD-header lower-edge point",
          controls: "Chat -> Agents resets before each trial; 5 downward ticks; same confirmed target HWND; shared SetCursorPos precondition; each pair changes one factor only",
        },
        trials: [],
      };
      persistReport(report);
      requireCondition(process.platform === "win32", `Native Windows probe cannot run on ${process.platform}`);
      requireCondition(existsSync(NATIVE_INPUT_SCRIPT), `Native SendInput helper is missing: ${NATIVE_INPUT_SCRIPT}`);

      for (const condition of CONDITIONS) {
        await runTrial(appHandle, condition, report);
      }

      const referenceTrial = report.trials[0];
      const sameViewportBounds = report.trials.every((trial) =>
        JSON.stringify(trial.viewportGeometry?.bounds) === JSON.stringify(referenceTrial?.viewportGeometry?.bounds));
      const sameCompositionBounds = report.trials.every((trial) =>
        JSON.stringify(trial.before?.composition?.windowLocalBounds) ===
          JSON.stringify(referenceTrial?.before?.composition?.windowLocalBounds));
      const sameScreenshotDimensions = report.trials.every((trial) =>
        JSON.stringify(trial.before?.screenshotDimensions) ===
          JSON.stringify(referenceTrial?.before?.screenshotDimensions));
      report.resetConsistency = {
        sameViewportBounds,
        sameCompositionBounds,
        sameScreenshotDimensions,
        baselineBeforeScreenshots: report.trials.map((trial) => ({
          id: trial.id,
          diffFromFirst: referenceTrial?.before?.screenshot?.path && trial.before?.screenshot?.path
            ? imageDifference(
              join(SCREENSHOT_DIR, basename(referenceTrial.before.screenshot.path)),
              join(SCREENSHOT_DIR, basename(trial.before.screenshot.path)),
            )
            : null,
        })),
      };

      report.factorComparisons = {
        A_lowerEdge_moveVersusNoMove: pairedComparison(report, "no-move-lower-edge", "move-lower-edge"),
        B_noMove_centerVersusLowerEdge: pairedComparison(report, "no-move-lower-edge", "no-move-center"),
        A_center_moveVersusNoMove: pairedComparison(report, "no-move-center", "move-center"),
        B_explicitMove_centerVersusLowerEdge: pairedComparison(report, "move-lower-edge", "move-center"),
      };
      report.assessment = "Observations only; do not declare a cause until raw frames and UIA/pixel readbacks are inspected.";
      report.status = "measurement-validation-pending";
      persistReport(report);
      console.log("[COMPOSITION-WHEEL-AB-SUMMARY]", JSON.stringify({
        report: `verify/cua/screenshots/${basename(REPORT_PATH)}`,
        driver: report.driver,
        factorComparisons: report.factorComparisons,
      }));

      requireCondition(report.trials.length === CONDITIONS.length,
        `Expected ${CONDITIONS.length} trials, got ${report.trials.length}`);
      requireCondition(report.resetConsistency?.sameViewportBounds &&
        report.resetConsistency?.sameCompositionBounds &&
        report.resetConsistency?.sameScreenshotDimensions,
      `Trial reset geometry was not stable; the A/B variables were not isolated (${JSON.stringify(report.resetConsistency)})`);
      const incomplete = report.trials.filter((trial) =>
        trial.errors.length > 0 || !trial.inputDelivered ||
        !trial.activation?.landed_on_target || !trial.pointerPositionResult?.positioned ||
        !trial.before?.screenshot?.sha256 ||
        !trial.after?.screenshot?.sha256 || !trial.before?.composition ||
        !trial.after?.composition || !trial.pixelDifference || !trial.viewportGeometry ||
        (trial.explicitMove ? trial.explicitMoveResult?.sendInputCount !== 1 : trial.explicitMoveResult != null),
      );
      report.status = incomplete.length === 0 ? "measurements-captured" : "measurement-incomplete";
      persistReport(report);
      requireCondition(incomplete.length === 0,
        `One or more A/B trials were incomplete or failed closed: ${JSON.stringify(incomplete.map((trial) => ({ id: trial.id, errors: trial.errors, inputDelivered: trial.inputDelivered, activation: trial.activation, before: Boolean(trial.before), after: Boolean(trial.after), explicitMoveResult: trial.explicitMoveResult })))}`);
      for (const trial of report.trials) {
        if (trial.explicitMove) {
          requireCondition(trial.explicitMoveResult?.sendInputCount === 1,
            `Explicit MOVE arm lacks a verified native SendInput event: ${trial.id}`);
        } else {
          requireCondition(trial.explicitMoveResult == null,
            `No-MOVE arm unexpectedly injected a movement event: ${trial.id}`);
        }
      }
    },
  },
];

let outcome;
try {
  outcome = await runDemoSuite("Sophos Composition native wheel A/B probe", tests);
} finally {
  // runDemoSuite normally handles teardown; this second idempotent cleanup also
  // covers initial-launch failures before its per-test lifecycle begins.
  await afterAll();
}

if (outcome?.failed > 0) process.exitCode = 1;
