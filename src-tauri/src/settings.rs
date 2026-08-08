//! Settings — reads `~/.prime/agent/settings.json` for operator configuration.
//!
//! Currently only `daemonCliPath` is consumed by the Rust shell. The file is
//! optional; a sensible default is used when it is absent or malformed.
//!
//! The daemon CLI path never hardcodes a developer's machine: it resolves
//! from the app's own directory (a sibling `prime-agent-ref` checkout), or
//! from the `PRIME_DAEMON_CLI_PATH` environment variable, or from the
//! `daemonCliPath` field in the settings file. This keeps the app open-source
//! clean and portable.

use std::path::PathBuf;

/// Env var that can point the shell at a specific daemon CLI entrypoint.
pub const DAEMON_CLI_ENV: &str = "PRIME_DAEMON_CLI_PATH";

/// Strip the Windows extended-length path prefix (`\\?\`) that Tauri's
/// resource_dir() returns. Node's module resolver chokes on it.
fn normalize_win_path(p: &std::path::Path) -> String {
    let s = p.to_string_lossy().to_string();
    if let Some(rest) = s.strip_prefix("\\\\?\\") {
        rest.to_string()
    } else {
        s
    }
}

/// Resolve the bundled runtime paths from the Tauri resource dir (packaged
/// installs) or fall back to the dev walk-up. Returns (node, daemon, bridge).
pub fn resolve_runtime_paths(resource_dir: Option<&std::path::Path>) -> (String, String, String) {
    // Operator override: settings.json `daemonCliPath` wins if present.
    let settings = Settings::load();
    if !settings.daemon_cli_path.is_empty()
        && settings.daemon_cli_path != default_daemon_cli()
        && std::path::Path::new(&settings.daemon_cli_path).is_file()
    {
        return ("node".to_string(), settings.daemon_cli_path, default_bridge_cli());
    }
    // Packaged: everything lives under the resource dir. The daemon and bridge
    // share one `node_modules` at the resource root (Node walks up parent dirs
    // to resolve it), so we only need to verify the daemon + bridge entrypoints
    // and the shared node_modules exist.
    if let Some(rd) = resource_dir {
        let node = rd.join("node").join("node.exe");
        let daemon = rd.join("daemon").join("dist").join("cli.js");
        let bridge = rd.join("bridge").join("dist").join("bridge").join("src").join("index.js");
        let shared_nm = rd.join("node_modules");
        if node.is_file() && daemon.is_file() && bridge.is_file() && shared_nm.is_dir() {
            return (
                normalize_win_path(&node),
                normalize_win_path(&daemon),
                normalize_win_path(&bridge),
            );
        }
    }
    // Dev fallback: system node + walk-up to the reference checkout.
    let daemon = default_daemon_cli();
    let bridge = default_bridge_cli();
    ("node".to_string(), daemon, bridge)
}

/// Default daemon CLI entrypoint (the Prime Agent coding-agent CLI), resolved
/// relative to the running app's executable directory.
fn default_daemon_cli() -> String {
    if let Ok(v) = std::env::var(DAEMON_CLI_ENV) {
        if !v.trim().is_empty() {
            return v.trim().to_string();
        }
    }
    // Look for a `prime-agent-ref` checkout near this app. The exe lives at
    // <app>/src-tauri/target/{debug,release}/prime-agent-windows.exe, so the
    // reference checkout is several directories up (a sibling of <app>).
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let mut probe = Some(dir.to_path_buf());
            for _ in 0..6 {
                if let Some(p) = probe.take() {
                    for rel in [
                        "prime-agent-ref/packages/coding-agent/dist/cli.js",
                        "../prime-agent-ref/packages/coding-agent/dist/cli.js",
                        "../../prime-agent-ref/packages/coding-agent/dist/cli.js",
                        "../../../prime-agent-ref/packages/coding-agent/dist/cli.js",
                    ] {
                        let candidate = p.join(rel);
                        if candidate.is_file() {
                            return candidate.to_string_lossy().to_string();
                        }
                    }
                    probe = p.parent().map(|pp| pp.to_path_buf());
                }
            }
        }
    }
    // Final fallback: the app looks for the CLI in the current directory.
    "prime-agent-ref/packages/coding-agent/dist/cli.js".to_string()
}

/// Default bridge sidecar entrypoint, resolved relative to the exe (dev).
fn default_bridge_cli() -> String {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let mut probe = Some(dir.to_path_buf());
            for _ in 0..6 {
                if let Some(p) = probe.take() {
                    let candidate = p.join("bridge").join("dist").join("bridge").join("src").join("index.js");
                    if candidate.is_file() {
                        return candidate.to_string_lossy().to_string();
                    }
                    probe = p.parent().map(|pp| pp.to_path_buf());
                }
            }
        }
    }
    "bridge/dist/bridge/src/index.js".to_string()
}

/// The settings file location: `~/.prime/agent/settings.json`.
pub fn settings_path() -> PathBuf {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home)
        .join(".prime")
        .join("agent")
        .join("settings.json")
}

/// Resolved runtime settings.
#[derive(Debug, Clone)]
pub struct Settings {
    /// Path to the daemon CLI script (`node <path> --mode daemon`).
    pub daemon_cli_path: String,
    /// When true, launch the daemon + bridge with `PRIME_DAEMON_TCP=1` so the
    /// IPC uses the TCP-loopback fallback instead of a Windows named pipe.
    /// This is the escape hatch for machines where `CreateNamedPipeW` is wedged
    /// (ERROR_INVALID_NAME) while TCP loopback still works. Default: false
    /// (named pipe stays the transport).
    pub daemon_tcp: bool,
}

impl Settings {
    /// Load settings from disk, falling back to defaults on any error.
    pub fn load() -> Self {
        let mut settings = Settings {
            daemon_cli_path: default_daemon_cli(),
            daemon_tcp: false,
        };

        let path = settings_path();
        let content = match std::fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => return settings,
        };
        let value: serde_json::Value = match serde_json::from_str(&content) {
            Ok(v) => v,
            Err(_) => return settings,
        };
        if let Some(p) = value.get("daemonCliPath").and_then(|v| v.as_str()) {
            if !p.trim().is_empty() {
                settings.daemon_cli_path = p.to_string();
            }
        }
        // `daemonTcp` accepts a real bool or the string "true"/"1" for hand-edits.
        settings.daemon_tcp = match value.get("daemonTcp") {
            Some(serde_json::Value::Bool(b)) => *b,
            Some(serde_json::Value::String(s)) => {
                matches!(s.trim().to_ascii_lowercase().as_str(), "true" | "1" | "yes" | "on")
            }
            _ => false,
        };
        settings
    }
}
