/// <reference types="vite/client" />

// Typed globals injected by the Tauri shell and used by the IPC client.
// Keeping these declared (instead of casting `window as any`) means the demo
// mode flag and the debug IPC handle are fully typed in production code.
interface Window {
  /** Set by the Rust shell in `--demo` / `SOPHOS_DEMO_MODE=1` mode. */
  __SOPHOS_DEMO__?: boolean;
  /** Debug handle the IPC client exposes so the e2e harness can patch the singleton. */
  __sophosIpc?: unknown;
}
