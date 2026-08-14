// useTheme — applies the persisted Settings.theme to the document root and keeps
// it in sync with the OS preference when the setting is "system".
//
// Reads settings once on mount, then subscribes to the theme store so a change
// from anywhere (e.g. the GeneralPanel Select calling applyTheme) re-applies the
// theme and keeps the "system" matchMedia subscription live. The inline
// anti-flash script in index.html handles the pre-render application for the
// browser preview; this hook covers the reactive path (initial load in Tauri,
// where settings come from the daemon asynchronously, plus live system changes).

import { useEffect } from "react";
import { useIpc } from "../ipc/client";
import { applyTheme, subscribeTheme, type Theme } from "../design/theme";

export function useTheme(): void {
  const ipc = useIpc();

  useEffect(() => {
    let disposed = false;
    let mql: MediaQueryList | null = null;
    let onSystemChange: (() => void) | null = null;

    const apply = (theme: Theme) => {
      if (disposed) return;
      applyTheme(theme);

      // Keep "system" live: re-resolve when the OS preference flips.
      if (theme === "system") {
        if (!mql && typeof window.matchMedia === "function") {
          mql = window.matchMedia("(prefers-color-scheme: dark)");
          onSystemChange = () => applyTheme("system");
          mql.addEventListener("change", onSystemChange);
        }
      } else if (mql && onSystemChange) {
        mql.removeEventListener("change", onSystemChange);
        mql = null;
        onSystemChange = null;
      }
    };

    ipc
      .getSettings()
      .then((s) => apply(s.theme ?? "dark"))
      .catch(() => apply("dark"));

    // React to theme changes from anywhere (e.g. the GeneralPanel Select).
    const unsubscribe = subscribeTheme((theme) => apply(theme));

    return () => {
      disposed = true;
      unsubscribe();
      if (mql && onSystemChange) mql.removeEventListener("change", onSystemChange);
    };
  }, [ipc]);
}
