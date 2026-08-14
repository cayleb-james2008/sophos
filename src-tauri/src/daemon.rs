//! Daemon lifecycle — spawns and supervises the Prime Agent daemon.
//!
//! The daemon is launched as `node <daemonCli> --mode daemon`. It listens on
//! the Windows named pipe `\\.\pipe\prime-agent-daemon`; the Node bridge
//! sidecar connects to that pipe. The Rust shell does NOT talk to the pipe
//! directly — it only owns the daemon process lifecycle (spawn, health check,
//! graceful shutdown) so nothing is orphaned on app exit.
//!
//! TCP fallback: when settings.json has `daemonTcp: true`, the daemon is
//! launched with `PRIME_DAEMON_TCP=1`, which makes `defaultDaemonSocketPath()`
//! resolve to `tcp://127.0.0.1:48100` instead of the named pipe. The bridge is
//! launched with the same env so both ends agree on the endpoint. This is the
//! escape hatch for machines where named-pipe creation is broken while TCP
//! loopback still works.
//!
//! stdout and stderr are both piped and forwarded to the frontend via
//! `engine-log` Tauri events, so the daemon's output is visible inside the
//! app instead of discarded or inherited by a parent console.

use std::io::BufReader;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use crate::engine_log::{spawn_reader, EngineLogSink, Proc, Stream};
use crate::job::Job;

/// Windows flag: do not create a console window for the child. Without this,
/// spawning a console node process from a GUI app flashes a terminal window
/// on every spawn (and every crash-loop restart).
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Owns the daemon child process and its lifecycle.
pub struct DaemonManager {
    child: Mutex<Option<Child>>,
    running: Arc<AtomicBool>,
    job: Arc<Job>,
    node_path: Mutex<String>,
    cli_path: Mutex<String>,
    preload_path: Mutex<String>,
    daemon_tcp: Mutex<bool>,
    log_sink: Mutex<Option<Arc<EngineLogSink>>>,
}

impl DaemonManager {
    pub fn new(job: Arc<Job>) -> Arc<Self> {
        Arc::new(Self {
            child: Mutex::new(None),
            running: Arc::new(AtomicBool::new(false)),
            job,
            node_path: Mutex::new(String::new()),
            cli_path: Mutex::new(String::new()),
            preload_path: Mutex::new(String::new()),
            daemon_tcp: Mutex::new(false),
            log_sink: Mutex::new(None),
        })
    }

    /// Set the log sink so captured stdout/stderr lines are forwarded to the frontend.
    pub fn set_log_sink(&self, sink: Arc<EngineLogSink>) {
        *self.log_sink.lock().unwrap() = Some(sink);
    }

    /// Set the runtime paths (so restart can re-spawn without re-passing them).
    /// `preload_path` is the `--require` preload module (empty = don't inject).
    pub fn set_paths(&self, node_path: String, cli_path: String, preload_path: String) {
        *self.node_path.lock().unwrap() = node_path;
        *self.cli_path.lock().unwrap() = cli_path;
        *self.preload_path.lock().unwrap() = preload_path;
    }

    /// Spawn the daemon. Idempotent — if one is already running, this is a no-op.
    ///
    /// `daemon_tcp` selects the TCP-loopback fallback transport (sets
    /// `PRIME_DAEMON_TCP=1` on the child). When false, the daemon keeps its
    /// default named-pipe transport unchanged.
    pub fn start(&self, node_path: &str, cli_path: &str, daemon_tcp: bool) {
        if self.is_alive() {
            return;
        }
        *self.daemon_tcp.lock().unwrap() = daemon_tcp;
        self.running.store(true, Ordering::SeqCst);
        let mut cmd = Command::new(node_path);
        // Inject the child_process windowsHide preload BEFORE the CLI path so it
        // loads before the daemon CLI. The daemon's own children (kernels,
        // shells, tools) then default to windowsHide:true and stop flashing
        // console windows. When no preload was resolved, skip --require so the
        // spawn stays identical to before.
        let preload = self.preload_path.lock().unwrap().clone();
        if !preload.is_empty() {
            cmd.arg("--require").arg(&preload);
        }
        cmd.arg(cli_path)
            .arg("--mode")
            .arg("daemon")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if daemon_tcp {
            cmd.env("PRIME_DAEMON_TCP", "1");
        }
        // The daemon's own kernel bootstrap selects the platform-correct
        // interpreter path. Do not inject a guessed override here: a stale or
        // partial venv would disable bootstrap and leave the app without a
        // kernel. The child is still hidden so GUI startup stays silent.
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);
        match cmd.spawn() {
            Ok(mut child) => {
                self.job.assign(&child);

                // Capture stdout and stderr, forward to the frontend.
                if let Some(sink) = self.log_sink.lock().unwrap().as_ref() {
                    if let Some(stdout) = child.stdout.take() {
                        spawn_reader(sink.clone(), Proc::Daemon, Stream::Stdout, BufReader::new(stdout));
                    }
                    if let Some(stderr) = child.stderr.take() {
                        spawn_reader(sink.clone(), Proc::Daemon, Stream::Stderr, BufReader::new(stderr));
                    }
                }

                *self.child.lock().unwrap() = Some(child);
                let transport = if daemon_tcp { "tcp-loopback" } else { "named-pipe" };
                let preload_desc = if preload.is_empty() { String::new() } else { format!(" --require {preload}") };
                eprintln!("[daemon] spawned ({transport}):{preload_desc} {node_path} {cli_path} --mode daemon");
            }
            Err(e) => {
                eprintln!("[daemon] failed to spawn: {e}");
                if let Some(sink) = self.log_sink.lock().unwrap().as_ref() {
                    sink.push(
                        Proc::Daemon,
                        Stream::Stderr,
                        format!("[daemon] failed to spawn: {e}"),
                    );
                }
            }
        }
    }

    /// Restart the daemon — kill the old one and spawn a fresh one.
    pub fn restart(&self) {
        // Kill existing
        self.shutdown();
        // Re-spawn if we have paths
        let node = self.node_path.lock().unwrap().clone();
        let cli = self.cli_path.lock().unwrap().clone();
        if !node.is_empty() && !cli.is_empty() {
            if let Some(sink) = self.log_sink.lock().unwrap().as_ref() {
                sink.push(Proc::Daemon, Stream::Stdout, "[daemon] restarting...".to_string());
            }
            let tcp = *self.daemon_tcp.lock().unwrap();
            self.start(&node, &cli, tcp);
        }
    }

    /// True if the daemon process is currently alive.
    pub fn is_alive(&self) -> bool {
        if let Some(child) = self.child.lock().unwrap().as_mut() {
            matches!(child.try_wait(), Ok(None))
        } else {
            false
        }
    }

    /// Kill the daemon and reap it. Safe to call multiple times.
    pub fn shutdown(&self) {
        self.running.store(false, Ordering::SeqCst);
        let child = self.child.lock().unwrap().take();
        if let Some(mut child) = child {
            let _ = child.kill();
            let _ = child.wait();
            eprintln!("[daemon] shut down");
        }
    }
}
