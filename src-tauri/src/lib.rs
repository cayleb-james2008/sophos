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

use std::sync::Arc;
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
    state.sidecar.restart();
    state.daemon.restart();
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
        .setup(move |app| {
            let handle = app.handle().clone();
            let job = Arc::new(Job::new().unwrap_or_else(|| {
                eprintln!("[job] failed to create job object; orphans possible on hard kill");
                Job::null()
            }));
            // Resolve bundled runtime paths (packaged) or dev walk-up.
            let resource_dir = app.path().resource_dir().ok();
            let (node_path, daemon_path, bridge_path) =
                settings::resolve_runtime_paths(resource_dir.as_deref());
            // `daemonTcp` selects the TCP-loopback fallback transport. The daemon
            // and the bridge are launched with the SAME flag so both resolve
            // `defaultDaemonSocketPath()` to the same endpoint.
            let settings = settings::Settings::load();
            let daemon_tcp = settings.daemon_tcp;

            // Create the engine log sink (shared ring buffer + event emitter).
            let log_sink = EngineLogSink::new(handle.clone());

            // Create daemon manager, wire up paths + log sink.
            let daemon = DaemonManager::new(job.clone());
            daemon.set_paths(node_path.clone(), daemon_path.clone());
            daemon.set_log_sink(log_sink.clone());

            let sidecar = SidecarManager::new(
                handle.clone(),
                job.clone(),
                node_path.clone(),
                bridge_path,
                daemon_tcp,
            );
            sidecar.set_log_sink(log_sink.clone());

            daemon.start(&node_path, &daemon_path, daemon_tcp);
            sidecar.start();
            spawn_health_monitor(handle, daemon.clone(), sidecar.clone(), daemon_tcp);

            app.manage(AppState {
                sidecar,
                daemon,
                log_sink,
                _job: job,
            });
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
            get_engine_status
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
