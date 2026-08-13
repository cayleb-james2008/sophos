// Theme application — maps the persisted Settings.theme onto the DOM so the
// CSS custom properties in global.css switch the whole palette.
//
// The CSS layer owns the actual colors: `:root` carries the dark defaults and
// `:root[data-theme="light"]` overrides them. This module only decides which
// `data-theme` value to put on <html>.
//
// It is a tiny reactive store: `applyTheme` records the current setting and
// notifies subscribers, so the useTheme hook (and anything else) can react to a
// theme change from anywhere (e.g. the GeneralPanel Select) and keep the
// "system" subscription live. The inline anti-flash script in index.html
// duplicates the resolution logic, since it runs before any module is loaded.

export type Theme = "dark" | "light" | "system";

let currentTheme: Theme = "dark";
const listeners = new Set<(theme: Theme) => void>();

/** Resolve a theme setting to a concrete palette, following the OS for "system". */
export function resolveTheme(theme: Theme): "dark" | "light" {
  if (theme === "system") {
    const dark =
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
        : true;
    return dark ? "dark" : "light";
  }
  return theme;
}

/** The current theme setting (defaults to "dark"). */
export function getTheme(): Theme {
  return currentTheme;
}

/**
 * Apply a theme setting to the document root immediately and notify
 * subscribers. Re-applying the same setting still re-resolves the DOM (so a
 * "system" re-resolve on OS change lands), but only notifies on an actual
 * change to avoid notify loops.
 */
export function applyTheme(theme: Theme): void {
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", resolveTheme(theme));
  }
  if (theme !== currentTheme) {
    currentTheme = theme;
    listeners.forEach((l) => l(theme));
  }
}

/** Subscribe to theme-setting changes. Returns an unsubscribe function. */
export function subscribeTheme(cb: (theme: Theme) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
