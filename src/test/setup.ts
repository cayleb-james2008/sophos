import "@testing-library/jest-dom";

// Node 26 exposes an experimental global localStorage getter that is unset
// unless --localstorage-file is provided. Vitest's global proxy shadows
// jsdom's configured-origin storage in that runtime, so restore the browser
// storage from the underlying jsdom window for tests that exercise persistence.
const jsdomWindow = (window as Window & { jsdom?: { window?: Window } }).jsdom?.window;
if (jsdomWindow?.localStorage && typeof window.localStorage === "undefined") {
  for (const target of [window, globalThis]) {
    Object.defineProperty(target, "localStorage", {
      configurable: true,
      value: jsdomWindow.localStorage,
    });
  }
}
