//! Sidecar lifecycle + JSON-RPC bridge.
//!
//! The Node bridge sidecar (`bridge/dist/bridge/src/index.js`) is spawned as a child
//! process. It speaks JSON-RPC over stdio:
//!   - reads one JSON line per command from stdin,
//!   - writes one JSON line per event to stdout.
//!
//! The Rust shell owns the sidecar process: it forwards `IpcCommand`s from the
//! frontend to the sidecar's stdin, forwards `IpcEvent`s from the sidecar's
//! stdout to the frontend as Tauri `ipc-event` events, and restarts the
//! sidecar if it crashes.
//!
//! The sidecar's stdout stays dedicated to JSON-RPC (it is NOT mixed into the
//! engine log stream). The sidecar's stderr is captured and forwarded to the
//! frontend via `engine-log` events, so log output is visible inside the app
//! instead of inherited by a parent console.

use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use tauri::{AppHandle, Emitter};

use crate::contract::IpcEvent;
use crate::engine_log::{spawn_reader, EngineLogSink, Proc, Stream};
use crate::job::Job;

/// Windows flag: do not create a console window for the child. Without this,
/// spawning a console node process from a GUI app flashes a terminal window
/// on every spawn (and every crash-loop restart).
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn can_recover_after_eof(running: bool, current_generation: u64, eof_generation: u64) -> bool {
    running && current_generation == eof_generation
}

/// Owns the sidecar child process, its stdin/stdout, and restart-on-crash.
pub struct SidecarManager {
    app: AppHandle,
    child: Mutex<Option<Child>>,
    stdin: Mutex<Option<ChildStdin>>,
    running: Arc<AtomicBool>,
    /// Invalidates EOF recovery callbacks when an explicit restart or shutdown wins the race.
    generation: AtomicU64,
    /// Serializes spawn/stop/restart so only one child can be owned at a time.
    lifecycle: Mutex<()>,
    job: Arc<Job>,
    node_path: String,
    bridge_path: String,
    /// When true, spawn the bridge with `PRIME_DAEMON_TCP=1` so its
    /// `defaultDaemonSocketPath()` resolves to the same TCP-loopback endpoint
    /// the daemon is listening on. Must match the daemon's transport.
    daemon_tcp: bool,
    log_sink: Mutex<Option<Arc<EngineLogSink>>>,
}

impl SidecarManager {
    pub fn new(
        app: AppHandle,
        job: Arc<Job>,
        node_path: String,
        bridge_path: String,
        daemon_tcp: bool,
    ) -> Arc<Self> {
        Arc::new(Self {
            app,
            child: Mutex::new(None),
            stdin: Mutex::new(None),
            running: Arc::new(AtomicBool::new(false)),
            generation: AtomicU64::new(0),
            lifecycle: Mutex::new(()),
            job,
            node_path,
            bridge_path,
            daemon_tcp,
            log_sink: Mutex::new(None),
        })
    }

    /// Set the log sink so captured stderr lines are buffered AND forwarded
    /// to the frontend (both live events and `get_engine_logs` initial load).
    pub fn set_log_sink(&self, sink: Arc<EngineLogSink>) {
        *self.log_sink.lock().unwrap() = Some(sink);
    }

    /// Start the sidecar. Idempotent — if one is already running, no-op.
    pub fn start(self: &Arc<Self>) {
        let _lifecycle = self.lifecycle.lock().unwrap();
        if self.is_alive() {
            return;
        }
        self.running.store(true, Ordering::SeqCst);
        self.spawn_locked();
    }

    /// Spawn a fresh sidecar child and its stdout reader thread.
    /// Caller must hold `lifecycle`.
    fn spawn_locked(self: &Arc<Self>) {
        let node_path = self.node_path.clone();
        let sidecar_path = self.bridge_path.clone();
        let mut cmd = Command::new(&node_path);
        cmd.arg(&sidecar_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())  // JSON-RPC responses
            .stderr(Stdio::piped()); // logs — captured
        if self.daemon_tcp {
            cmd.env("PRIME_DAEMON_TCP", "1");
        }
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        match cmd.spawn() {
            Ok(mut child) => {
                self.job.assign(&child);
                let stdin = child.stdin.take();
                let stdout = child.stdout.take();
                let stderr = child.stderr.take();
                *self.child.lock().unwrap() = Some(child);
                *self.stdin.lock().unwrap() = stdin;

                // stdout → JSON-RPC events (existing behavior, unchanged)
                if let Some(stdout) = stdout {
                    let this = Arc::clone(self);
                    std::thread::spawn(move || this.read_loop(stdout, generation));
                }

                // stderr → engine-log (buffered + forwarded via the shared sink)
                if let Some(stderr) = stderr {
                    if let Some(sink) = self.log_sink.lock().unwrap().as_ref() {
                        spawn_reader(sink.clone(), Proc::Sidecar, Stream::Stderr, BufReader::new(stderr));
                    }
                }

                eprintln!("[sidecar] spawned: {node_path} {sidecar_path}");
            }
            Err(e) => {
                eprintln!("[sidecar] failed to spawn: {e}");
                if self.generation.load(Ordering::SeqCst) == generation {
                    self.running.store(false, Ordering::SeqCst);
                }
                // Surface the failure in the engine panel
                if let Some(sink) = self.log_sink.lock().unwrap().as_ref() {
                    sink.push(Proc::Sidecar, Stream::Stderr, format!("[sidecar] failed to spawn: {e}"));
                }
            }
        }
    }

    /// Read the sidecar's stdout line-by-line, forwarding each JSON event to
    /// the frontend. On EOF (crash/exit), restart the same generation only if
    /// no explicit restart or shutdown has superseded it.
    fn read_loop(self: Arc<Self>, stdout: ChildStdout, generation: u64) {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            let line = match line {
                Ok(l) => l,
                Err(_) => break,
            };
            if line.trim().is_empty() {
                continue;
            }
            // Try to parse as an IpcEvent first (events have a "type" field).
            match serde_json::from_str::<IpcEvent>(&line) {
                Ok(event) => {
                    let _ = self.app.emit("ipc-event", event);
                }
                Err(_) => {
                    // Not an event — try to parse as a JSON-RPC response
                    // (responses have an "id" field). Forward as ipc-response.
                    if let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) {
                        if val.get("id").is_some() {
                            let _ = self.app.emit("ipc-response", &val);
                        }
                    }
                    // Silently drop lines that are neither events nor responses.
                }
            }
        }
        eprintln!("[sidecar] stdout closed");
        if self.running.load(Ordering::SeqCst) {
            // Back off briefly before restarting so a crash-looping sidecar
            // (e.g. missing build output) does not spin a hot loop.
            std::thread::sleep(std::time::Duration::from_millis(1000));
            self.recover_after_eof(generation);
        }
    }

    /// Recover an EOF only while the child that produced it is still current.
    fn recover_after_eof(self: &Arc<Self>, generation: u64) {
        let _lifecycle = self.lifecycle.lock().unwrap();
        if !can_recover_after_eof(
            self.running.load(Ordering::SeqCst),
            self.generation.load(Ordering::SeqCst),
            generation,
        ) {
            return;
        }
        self.restart_locked();
    }

    /// Kill the current sidecar (if any) and spawn a fresh one.
    pub fn restart(self: &Arc<Self>) {
        let _lifecycle = self.lifecycle.lock().unwrap();
        self.running.store(true, Ordering::SeqCst);
        self.restart_locked();
    }

    /// Caller must hold `lifecycle`.
    fn restart_locked(self: &Arc<Self>) {
        // Invalidate any reader thread that is about to observe the old child's EOF.
        self.generation.fetch_add(1, Ordering::SeqCst);
        let old = self.child.lock().unwrap().take();
        *self.stdin.lock().unwrap() = None;
        if let Some(mut child) = old {
            let _ = child.kill();
            let _ = child.wait();
        }
        // Surface the restart in the engine panel
        if let Some(sink) = self.log_sink.lock().unwrap().as_ref() {
            sink.push(Proc::Sidecar, Stream::Stderr, "[sidecar] restarting...".to_string());
        }
        self.spawn_locked();
    }

    /// Forward a command to the sidecar as a single JSON line on stdin.
    pub fn send_command(&self, command: &serde_json::Value) -> Result<(), String> {
        let line = serde_json::to_string(command).map_err(|e| e.to_string())?;
        let mut stdin = self.stdin.lock().unwrap();
        match stdin.as_mut() {
            Some(s) => {
                s.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
                s.write_all(b"\n").map_err(|e| e.to_string())?;
                s.flush().map_err(|e| e.to_string())
            }
            None => Err("sidecar not running".to_string()),
        }
    }

    /// True if the sidecar process is currently alive.
    pub fn is_alive(&self) -> bool {
        if let Some(child) = self.child.lock().unwrap().as_mut() {
            matches!(child.try_wait(), Ok(None))
        } else {
            false
        }
    }

    /// Kill the sidecar and reap it. Safe to call multiple times.
    pub fn shutdown(&self) {
        let _lifecycle = self.lifecycle.lock().unwrap();
        self.running.store(false, Ordering::SeqCst);
        self.generation.fetch_add(1, Ordering::SeqCst);
        let child = self.child.lock().unwrap().take();
        *self.stdin.lock().unwrap() = None;
        if let Some(mut child) = child {
            let _ = child.kill();
            let _ = child.wait();
            eprintln!("[sidecar] shut down");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::can_recover_after_eof;

    #[test]
    fn explicit_restart_invalidates_stale_eof_recovery() {
        assert!(can_recover_after_eof(true, 4, 4));
        assert!(!can_recover_after_eof(true, 5, 4));
    }

    #[test]
    fn shutdown_invalidates_eof_recovery() {
        assert!(!can_recover_after_eof(false, 4, 4));
    }
}
