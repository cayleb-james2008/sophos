//! Engine log capture — a bounded ring buffer of process log lines from the
//! daemon and the Node bridge sidecar, forwarded live to the frontend as
//! Tauri `engine-log` events.
//!
//! Both processes have their stdout and stderr piped (the sidecar's stdout
//! stays dedicated to JSON-RPC — only its stderr is logged here; the daemon's
//! both stdout and stderr are logged). Each captured line is tagged with the
//! source process and stream name, stored in a bounded ring buffer, and
//! emitted as an `engine-log` event to the frontend.

use std::collections::VecDeque;
use std::io::BufRead;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

/// Which process a log line came from.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Proc {
    Daemon,
    Sidecar,
}

/// Which stream a log line came from.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Stream {
    Stdout,
    Stderr,
}

/// A single captured log line, tagged with source process and stream.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineLogEntry {
    pub proc: Proc,
    pub stream: Stream,
    pub line: String,
    /// ISO-8601 timestamp (best-effort local time).
    pub ts: String,
}

/// Bounded ring buffer of recent log lines, shared between the reader threads
/// and the Tauri command that serves the initial load.
const MAX_LINES: usize = 2000;

/// Shared engine-log state: the ring buffer + the app handle for emitting events.
pub struct EngineLogSink {
    buffer: Mutex<VecDeque<EngineLogEntry>>,
    app: AppHandle,
}

impl EngineLogSink {
    pub fn new(app: AppHandle) -> Arc<Self> {
        Arc::new(Self {
            buffer: Mutex::new(VecDeque::with_capacity(MAX_LINES)),
            app,
        })
    }

    /// Push a log line into the ring buffer and emit it to the frontend.
    pub fn push(&self, proc: Proc, stream: Stream, line: String) {
        let entry = EngineLogEntry {
            proc,
            stream,
            line: line.trim_end_matches(['\r', '\n']).to_string(),
            ts: now_iso(),
        };
        {
            let mut buf = self.buffer.lock().unwrap();
            if buf.len() >= MAX_LINES {
                buf.pop_front();
            }
            buf.push_back(entry.clone());
        }
        let _ = self.app.emit("engine-log", &entry);
    }

    /// Drain and return all buffered log lines (for `get_engine_logs`).
    pub fn snapshot(&self) -> Vec<EngineLogEntry> {
        self.buffer.lock().unwrap().iter().cloned().collect()
    }

    /// Clear the ring buffer.
    pub fn clear(&self) {
        self.buffer.lock().unwrap().clear();
    }
}

/// Spawn a reader thread that reads lines from any `BufRead` source and pushes
/// them into the shared sink as the given (proc, stream).
pub fn spawn_reader<R: BufRead + Send + 'static>(sink: Arc<EngineLogSink>, proc: Proc, stream: Stream, reader: R) {
    std::thread::spawn(move || {
        for line in reader.lines() {
            match line {
                Ok(l) => {
                    if !l.trim().is_empty() {
                        sink.push(proc, stream, l);
                    }
                }
                Err(_) => break,
            }
        }
        // Emit a synthetic line when the stream closes so the panel reflects it.
        sink.push(proc, stream, format!("[{} {} stream closed]", proc_name(proc), stream_name(stream)));
    });
}

fn proc_name(p: Proc) -> &'static str {
    match p {
        Proc::Daemon => "daemon",
        Proc::Sidecar => "sidecar",
    }
}

fn stream_name(s: Stream) -> &'static str {
    match s {
        Stream::Stdout => "stdout",
        Stream::Stderr => "stderr",
    }
}

/// Best-effort ISO-8601 timestamp (UTC). Note: no chrono dependency.
fn now_iso() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let dur = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    let secs = dur.as_secs();
    // Convert epoch seconds to a human-readable timestamp (simplified, UTC).
    // Good enough for log timestamps — we don't need timezone-correct local time.
    let (year, month, day, hour, minute, second) = epoch_to_datetime(secs as i64);
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
}

/// Convert Unix epoch seconds to (year, month, day, hour, minute, second) in UTC.
/// Based on the civil calendar algorithm (Howard Hinnant's days_from_civil, reversed).
fn epoch_to_datetime(epoch: i64) -> (i32, u32, u32, u32, u32, u32) {
    let days = epoch.div_euclid(86400);
    let secs_of_day = epoch.rem_euclid(86400);
    let hour = (secs_of_day / 3600) as u32;
    let minute = ((secs_of_day % 3600) / 60) as u32;
    let second = (secs_of_day % 60) as u32;

    // Convert days since epoch (1970-01-01) to calendar date.
    // Days from civil: 1970-01-01 is day 719468 in the algorithm.
    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365; // [0, 399]
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = doy - (153 * mp + 2) / 5 + 1; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 }; // [1, 12]
    let year = if m <= 2 { y + 1 } else { y };

    (year as i32, m as u32, d as u32, hour, minute, second)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn epoch_to_known_date() {
        // 2021-01-01 00:00:00 UTC = 1609459200
        let (y, m, d, h, mi, s) = epoch_to_datetime(1609459200);
        assert_eq!(y, 2021);
        assert_eq!(m, 1);
        assert_eq!(d, 1);
        assert_eq!(h, 0);
        assert_eq!(mi, 0);
        assert_eq!(s, 0);
    }

    #[test]
    fn epoch_to_known_date_with_time() {
        // 2024-07-15 12:30:45 UTC
        let epoch = 1721046645;
        let (y, m, d, h, mi, s) = epoch_to_datetime(epoch);
        assert_eq!(y, 2024);
        assert_eq!(m, 7);
        assert_eq!(d, 15);
        assert_eq!(h, 12);
        assert_eq!(mi, 30);
        assert_eq!(s, 45);
    }
}
