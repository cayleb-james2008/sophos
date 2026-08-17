// UpdateBanner — auto-updater prompt (v0.7.2).
// The Rust shell checks the update feed at startup (fire-and-forget) and
// emits `update-available` with the announced version + notes. This banner
// offers one click to download, verify, and install the signed update, then
// relaunch. `update-install-error` surfaces a failed download/install.
// Mounted in the Shell next to the other reliability banners.

import { useEffect, useState } from "react";
import { Text, Button } from "../../design";
import "./updates.css";

type UpdateNotice =
  | { state: "idle" }
  | { state: "available"; version: string; notes: string }
  | { state: "installing" }
  | { state: "error"; message: string };

export function UpdateBanner() {
  const [notice, setNotice] = useState<UpdateNotice>({ state: "idle" });

  useEffect(() => {
    let cancelled = false;
    const unlisteners: Array<() => void> = [];
    (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      if (cancelled) return;
      const un1 = await listen<{ version: string; notes: string }>(
        "update-available",
        (event) => {
          if (!cancelled) {
            setNotice({
              state: "available",
              version: event.payload.version,
              notes: event.payload.notes,
            });
          }
        },
      );
      unlisteners.push(un1);
      const un2 = await listen<string>("update-install-error", (event) => {
        if (!cancelled) setNotice({ state: "error", message: event.payload });
      });
      unlisteners.push(un2);
    })();
    return () => {
      cancelled = true;
      unlisteners.forEach((un) => un());
    };
  }, []);

  const install = async () => {
    setNotice({ state: "installing" });
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("install_update");
    } catch {
      setNotice({ state: "error", message: "Could not start the update." });
    }
  };

  if (notice.state === "available") {
    return (
      <div role="alert" className="upd-banner">
        <div className="upd-banner__main">
          <Text variant="label" weight="semibold">
            Update available — Sophos {notice.version}
          </Text>
          {notice.notes ? (
            <Text variant="micro" tone="muted">
              {notice.notes.slice(0, 220)}
            </Text>
          ) : null}
        </div>
        <Button variant="accent-soft" size="sm" onClick={() => void install()}>
          Install &amp; restart
        </Button>
      </div>
    );
  }

  if (notice.state === "installing") {
    return (
      <div role="status" className="upd-banner upd-banner--quiet">
        <Text variant="label" weight="semibold">
          Downloading update — the app will restart when it is ready…
        </Text>
      </div>
    );
  }

  if (notice.state === "error") {
    return (
      <div role="alert" className="upd-banner upd-banner--error">
        <Text variant="label" weight="semibold" tone="danger">
          Update failed
        </Text>
        <Text variant="micro" tone="muted">
          {notice.message}
        </Text>
      </div>
    );
  }

  return null;
}

export default UpdateBanner;
