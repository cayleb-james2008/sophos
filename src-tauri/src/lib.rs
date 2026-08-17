//! Prime Agent — Windows native shell.
//!
//! A Tauri v2 (Rust) application that:
//!   - spawns and supervises the Prime Agent daemon (`node <cli> --mode daemon`),
//!   - spawns and supervises the Node bridge sidecar (`node bridge/dist/index.js`),
//!   - bridges JSON-RPC between the frontend and the sidecar over stdio,
//!   - captures daemon + sidecar stdout/stderr and forwards them to the
//!     frontend as `engine-log` Tauri events,
//!   - exposes native Rust perf commands to the frontend.
//!
//! The IPC contract types live in `contract.rs` and mirror `src/ipc/contract.ts`.

mod contract;
mod daemon;
mod engine_log;
mod job;
mod native;
mod settings;
mod sidecar;

use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, RunEvent};

use contract::{ConnectionStatus, IpcCommand, IpcEvent, SessionInfo, TokenEstimate, TranscriptMessage};
use daemon::DaemonManager;
use engine_log::{EngineLogEntry, EngineLogSink};
use job::Job;
use sidecar::SidecarManager;

/// Shared application state, managed by Tauri.
pub struct AppState {
    pub sidecar: Arc<SidecarManager>,
    pub daemon: Arc<DaemonManager>,
    pub log_sink: Arc<EngineLogSink>,
    /// Kept alive for the app's lifetime so the job object's
    /// `KILL_ON_JOB_CLOSE` guarantee holds until process teardown.
    _job: Arc<Job>,
}

// ---------------------------------------------------------------------------
// IPC bridge command
// ---------------------------------------------------------------------------

/// Forward a frontend command to the sidecar as one JSON line on its stdin.
#[tauri::command]
fn ipc_command(state: tauri::State<AppState>, command: serde_json::Value) -> Result<(), String> {
    state.sidecar.send_command(&command)
}

// ---------------------------------------------------------------------------
// Native perf commands
// ---------------------------------------------------------------------------

/// Parse a JSONL transcript file into messages.
#[tauri::command]
fn native_transcript_parse(path: String) -> Result<Vec<TranscriptMessage>, String> {
    native::transcript::parse(&path)
}

/// Estimate the token count of a string.
#[tauri::command]
fn native_token_estimate(text: String) -> TokenEstimate {
    native::token::estimate(&text)
}

/// Scan a session directory for saved sessions.
#[tauri::command]
fn native_session_scan(dir: String) -> Result<Vec<SessionInfo>, String> {
    native::session::scan(&dir)
}

/// Render markdown to an HTML fragment.
#[tauri::command]
fn native_markdown_render(markdown: String) -> String {
    native::markdown::render(&markdown)
}

// ---------------------------------------------------------------------------
// Profile Studio file portability commands (v0.7.1)
// ---------------------------------------------------------------------------
// Two tiny read/write commands back the Profile Studio's export/import: the
// frontend picks a path with the (already-permissioned) dialog plugin, then
// reads or writes the file contents here. They are frontend<->shell commands
// only — the daemon contract (contract.rs / src/ipc/contract.ts) is untouched.

/// Read a UTF-8 text file (used to import a custom profile).
#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("Could not read file: {e}"))
}

/// Write UTF-8 text to a file (used to export a custom profile).
#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| format!("Could not write file: {e}"))
}

// ---------------------------------------------------------------------------
// Engine log commands (NEW)
// ---------------------------------------------------------------------------

/// Return all buffered engine log lines (for initial panel load).
#[tauri::command]
fn get_engine_logs(state: tauri::State<AppState>) -> Vec<EngineLogEntry> {
    state.log_sink.snapshot()
}

/// Restart both the daemon and the sidecar.
#[tauri::command]
fn restart_engine(state: tauri::State<AppState>) -> Result<(), String> {
    // Stop the bridge before replacing the daemon so it cannot attach to the
    // old daemon between the two explicit restarts. Sidecar EOF recovery is
    // generation-guarded, so the stopped bridge cannot resurrect itself here.
    state.sidecar.shutdown();
    state.daemon.restart();
    state.sidecar.start();
    Ok(())
}

/// Stop both the daemon and the sidecar.
#[tauri::command]
fn stop_engine(state: tauri::State<AppState>) -> Result<(), String> {
    state.sidecar.shutdown();
    state.daemon.shutdown();
    state.log_sink.clear();
    Ok(())
}

/// Get the current engine status (daemon + sidecar alive flags).
#[tauri::command]
fn get_engine_status(state: tauri::State<AppState>) -> EngineStatus {
    EngineStatus {
        daemon_alive: state.daemon.is_alive(),
        sidecar_alive: state.sidecar.is_alive(),
    }
}

/// Engine process status, returned by `get_engine_status`.
#[derive(serde::Serialize, Clone)]
pub struct EngineStatus {
    pub daemon_alive: bool,
    pub sidecar_alive: bool,
}

// ---------------------------------------------------------------------------
// Auto-updater trigger (v0.7.2)
// ---------------------------------------------------------------------------
// The updater plugin (tauri-plugin-updater) is registered in `run()` below.
// It has no built-in "update available" prompt (its `dialog` option only
// covers install progress), so this module owns the whole check-and-prompt
// flow:
//   - at startup, a fire-and-forget task checks the feed (never blocks or
//     fails the app) and emits `update-available` (version + notes),
//     `update-up-to-date`, or `update-check-error` to the frontend;
//   - the frontend shows a banner and calls `install_update`, which
//     downloads + verifies the signed installer and relaunches the app.
// The found Update is parked here until the user accepts (or the app exits).
// SOPHOS_UPDATE_ENDPOINT overrides the compiled feed endpoint (staging/e2e).

static PENDING_UPDATE: Mutex<Option<tauri_plugin_updater::Update>> = Mutex::new(None);

/// Fire-and-forget startup update check.
fn spawn_update_check(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        if let Err(e) = check_for_update(&app).await {
            eprintln!("[updater] check failed: {e}");
            let _ = app.emit("update-check-error", e.to_string());
        }
    });
}

/// Query the update feed and surface the result to the frontend.
async fn check_for_update(app: &AppHandle) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;

    let mut builder = app.updater_builder();
    if let Ok(endpoint) = std::env::var("SOPHOS_UPDATE_ENDPOINT") {
        let url = url::Url::parse(&endpoint)
            .map_err(|e| format!("invalid SOPHOS_UPDATE_ENDPOINT '{endpoint}': {e}"))?;
        builder = builder.endpoints(vec![url]).map_err(|e| e.to_string())?;
        // Test/staging seam: the plugin rejects non-https endpoints in
        // release builds and requires real TLS verification by default.
        // This override is only active when the operator explicitly sets
        // SOPHOS_UPDATE_ENDPOINT (e2e apply test), so production stays on
        // the https feed with full certificate verification.
        builder = builder.configure_client(|client| client.danger_accept_invalid_certs(true));
    }
    let updater = builder.build().map_err(|e| e.to_string())?;

    match updater.check().await {
        Ok(Some(update)) => {
            let version = update.version.clone();
            let notes = update.body.clone().unwrap_or_default();
            eprintln!("[updater] update available: {version}");
            *PENDING_UPDATE.lock().unwrap() = Some(update);
            let _ = app.emit(
                "update-available",
                serde_json::json!({ "version": version, "notes": notes }),
            );
        }
        Ok(None) => {
            eprintln!("[updater] up to date");
            let _ = app.emit("update-up-to-date", ());
        }
        Err(e) => return Err(e.to_string()),
    }
    Ok(())
}

/// Install the pending update (found by the startup check) and relaunch.
#[tauri::command]
fn install_update(app: AppHandle) -> Result<(), String> {
    let update = PENDING_UPDATE
        .lock()
        .unwrap()
        .take()
        .ok_or_else(|| "no update pending".to_string())?;
    eprintln!("[updater] installing {}", update.version);
    tauri::async_runtime::spawn(async move {
        match update.download_and_install(|_, _| {}, || {}).await {
            Ok(()) => eprintln!("[updater] install complete"),
            Err(e) => {
                eprintln!("[updater] install failed: {e}");
                let _ = app.emit("update-install-error", e.to_string());
            }
        }
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// Health monitor
// ---------------------------------------------------------------------------

/// Periodically emit a `connection_status` event reflecting daemon/sidecar health.
///
/// Rust owns process lifecycle only; it cannot see through the bridge to the
/// daemon's pipe/socket, so the bridge is authoritative for the live
/// connection detail. Here we report process-level health, and when the daemon
/// process is dead (e.g. its `net.createServer().listen(pipe)` threw on the
/// wedged named-pipe path) we surface a plain-English reason that points at the
/// TCP escape hatch.
fn spawn_health_monitor(
    app: AppHandle,
    daemon: Arc<DaemonManager>,
    sidecar: Arc<SidecarManager>,
    daemon_tcp: bool,
) {
    std::thread::spawn(move || loop {
        let daemon_ok = daemon.is_alive();
        let sidecar_ok = sidecar.is_alive();
        let status = match (daemon_ok, sidecar_ok) {
            (true, true) => ConnectionStatus::Connected,
            (false, false) => {
                let reason = if daemon_tcp {
                    "Engine (daemon) is not running on the TCP-loopback transport."
                        .to_string()
                } else {
                    #[cfg(windows)]
                    {
                        "Engine (daemon) is not running. If the daemon couldn't start because Windows named-pipe creation is blocked (ERROR_INVALID_NAME while TCP loopback still works), enable TCP mode in Settings → Advanced.".to_string()
                    }
                    #[cfg(not(windows))]
                    {
                        "Engine (daemon) is not running.".to_string()
                    }
                };
                ConnectionStatus::Disconnected { reason: Some(reason) }
            }
            _ => ConnectionStatus::Reconnecting,
        };
        let _ = app.emit("ipc-event", IpcEvent::ConnectionStatus { status });
        std::thread::sleep(Duration::from_secs(3));
    });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point())]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(move |app| {
            let handle = app.handle().clone();
            let job = Arc::new(Job::new().unwrap_or_else(|| {
                eprintln!("[job] failed to create job object; orphans possible on hard kill");
                Job::null()
            }));
            // Demo mode: launched with `--demo` (cua-driver e2e) or
            // SOPHOS_DEMO_MODE=1. The app skips the daemon + sidecar and the
            // frontend uses the MockIpcClient, so the full UI is demonstrable
            // and testable without a live provider. This is a real feature —
            // it makes the desktop app testable via computer-use.
            let demo_mode = std::env::var("SOPHOS_DEMO_MODE").is_ok()
                || std::env::args().any(|a| a == "--demo");
            // Resolve bundled runtime paths (packaged) or dev walk-up.
            let resource_dir = app.path().resource_dir().ok();
            let (node_path, daemon_path, bridge_path) =
                settings::resolve_runtime_paths(resource_dir.as_deref());
            // Resolve the child_process windowsHide preload (may be None if not
            // found; daemon then spawns without --require).
            let preload_path = settings::resolve_preload_path(resource_dir.as_deref()).unwrap_or_default();
            // `daemonTcp` selects the TCP-loopback fallback transport. The daemon
            // and the bridge are launched with the SAME flag so both resolve
            // `defaultDaemonSocketPath()` to the same endpoint.
            let settings = settings::Settings::load();
            let daemon_tcp = settings.daemon_tcp;

            // Create the engine log sink (shared ring buffer + event emitter).
            let log_sink = EngineLogSink::new(handle.clone());

            // Create daemon manager, wire up paths + log sink.
            let daemon = DaemonManager::new(job.clone());
            daemon.set_paths(node_path.clone(), daemon_path.clone(), preload_path.clone());
            daemon.set_log_sink(log_sink.clone());

            let sidecar = SidecarManager::new(
                handle.clone(),
                job.clone(),
                node_path.clone(),
                bridge_path,
                daemon_tcp,
            );
            sidecar.set_log_sink(log_sink.clone());

            if demo_mode {
                eprintln!("[sophos] DEMO MODE — daemon/sidecar skipped, using mock IPC");
            } else {
                daemon.start(&node_path, &daemon_path, daemon_tcp);
                sidecar.start();
            }

            // Fire-and-forget update check — the app quietly polls the feed on
            // every launch and prompts only when a newer version exists.
            // Spawned before the health monitor below so `handle` is still
            // owned here (spawn_health_monitor takes it by value).
            spawn_update_check(handle.clone());
            if !demo_mode {
                spawn_health_monitor(handle, daemon.clone(), sidecar.clone(), daemon_tcp);
            }

            app.manage(AppState {
                sidecar,
                daemon,
                log_sink,
                _job: job,
            });

            // In demo mode, tell the frontend to use the MockIpcClient. This
            // runs before the webview loads the frontend, so the flag is set
            // before getIpcClient() is first called.
            if demo_mode {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.eval("window.__SOPHOS_DEMO__ = true;");
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ipc_command,
            native_transcript_parse,
            native_token_estimate,
            native_session_scan,
            native_markdown_render,
            get_engine_logs,
            restart_engine,
            stop_engine,
            get_engine_status,
            read_text_file,
            write_text_file,
            install_update
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    // Graceful shutdown: kill daemon + sidecar on app exit so nothing orphans.
    app.run(|app_handle, event| {
        if let RunEvent::Exit = event {
            if let Some(state) = app_handle.try_state::<AppState>() {
                state.sidecar.shutdown();
                state.daemon.shutdown();
            }
        }
    });
}
