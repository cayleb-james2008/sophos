import "@testing-library/jest-dom";

// Node 26 ships a native `globalThis.localStorage` that is `undefined` unless the process
// was started with `--localstorage-file=...` (see the ExperimentalWarning Node prints).
// That global is non-enumerable but *own*, so it shadows the working `localStorage`
// accessor jsdom installs on `window` — and because jsdom's `window` IS `globalThis` under
// vitest, bare `localStorage.clear()` in tests throws / no-ops.
//
// Restore jsdom's real Storage here, in the shared setup, so the suite passes on a plain
// `npm test` with no special NODE_OPTIONS flag on any supported Node version. The backing
// store is jsdom's own `_localStorage` (a spec-shaped Storage over a Map).
const jsdomStorage = (window as unknown as { _localStorage?: Storage })._localStorage;
if (jsdomStorage && !window.localStorage) {
  Object.defineProperty(globalThis, "localStorage", {
    value: jsdomStorage,
    configurable: true,
    writable: true,
    enumerable: false,
  });
}
