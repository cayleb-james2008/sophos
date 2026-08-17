//! lease.rs — conservative stale session-lease recovery at app startup.
//!
//! Upstream #667 / #841 / D39b reported that a crashed daemon leaves
//! `~/.prime/agent/session-leases/*.lock` directories behind, and a wedged
//! host then blocks every subsequent resume with `EPERM`. The bundled daemon
//! already reclaims a stale lease when it next acquires the SAME session
//! (see `prime-agent-ref/packages/coding-agent/src/core/session-lease.ts`,
//! `reclaimStaleLease` + `isLeaseOwnerAlive`), but two classes of debris are
//! NOT self-healed by the daemon:
//!
//!   1. `*.lock.stale-*` / `*.lock.candidate-*` temp directories — a crash
//!      between `rename` and `rm` in the daemon's reclaim/acquire path leaves
//!      these behind, and nothing ever removes them.
//!   2. `*.lock` directories whose `owner.json` records a PID that is no
//!      longer alive AND whose lease is older than a grace window.
//!
//! This module sweeps both at startup (before the daemon spawns) with a
//! strictly conservative rule: never remove anything unless the owner PID is
//! provably dead and the lease is past the grace window. Missing or malformed
//! owner data and an undeterminable PID-liveness answer both mean "keep".

use std::fs;
use std::path::Path;
use std::time::SystemTime;

/// Grace window: a lease is only reclaimed when it is older than this AND its
/// owner PID is provably dead. Generous on purpose — a supervisor that is
/// mid-restart is never touched.
pub const DEFAULT_LEASE_GRACE_MS: u64 = 60 * 60 * 1000; // 1 hour

/// Pure classification, side-effect-free so it can be unit-tested without a
/// filesystem. Returns true only when the owner is known, provably dead, and
/// the lease is past the grace window.
pub fn classify_stale_lease(
    owner_pid: Option<u32>,
    age_ms: u64,
    grace_ms: u64,
    pid_alive: &dyn Fn(u32) -> bool,
) -> bool {
    let Some(pid) = owner_pid else {
        // Unknown owner -> keep. Never delete on uncertainty.
        return false;
    };
    age_ms > grace_ms && !pid_alive(pid)
}

/// True when a directory name is an unambiguous crash leftover from the
/// daemon's lease reclaim/acquire path (`*.stale-*` / `*.candidate-*`).
pub fn is_lease_leftover(name: &str) -> bool {
    name.contains(".stale-") || name.contains(".candidate-")
}

/// Extract the owner PID from a lease directory's `owner.json` (best-effort).
/// Any parse failure returns `None`, which the sweep treats as "keep".
pub fn read_lease_owner_pid(dir: &Path) -> Option<u32> {
    let raw = fs::read_to_string(dir.join("owner.json")).ok()?;
    let value: serde_json::Value = serde_json::from_str(&raw).ok()?;
    let pid = value.get("pid")?.as_u64()?;
    u32::try_from(pid).ok()
}

/// Age of a directory in milliseconds, derived from its mtime (best-effort).
pub fn dir_age_ms(dir: &Path, now: SystemTime) -> Option<u64> {
    let modified = fs::metadata(dir).ok()?.modified().ok()?;
    let duration = now.duration_since(modified).ok()?;
    Some(duration.as_millis() as u64)
}

/// Summary of a startup lease sweep, surfaced in the engine log.
#[derive(Debug, Default)]
pub struct LeaseSweepSummary {
    pub leftovers_removed: usize,
    pub stale_leases_removed: usize,
    pub kept: usize,
}

/// Sweep `~/.prime/agent/session-leases/` for crash leftovers and stale
/// leases. `pid_alive` is the platform liveness oracle; returning `true` for
/// an unknown/undeterminable PID keeps the sweep conservative.
pub fn sweep_stale_leases(
    agent_dir: &Path,
    grace_ms: u64,
    pid_alive: &dyn Fn(u32) -> bool,
) -> LeaseSweepSummary {
    let leases_dir = agent_dir.join("session-leases");
    let mut summary = LeaseSweepSummary::default();
    let entries = match fs::read_dir(&leases_dir) {
        Ok(entries) => entries,
        // No leases dir yet -> nothing to clean.
        Err(_) => return summary,
    };
    let now = SystemTime::now();

    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let path = entry.path();

        if is_lease_leftover(&name) {
            if fs::remove_dir_all(&path).is_ok() {
                summary.leftovers_removed += 1;
            }
            continue;
        }

        if !name.ends_with(".lock") {
            continue;
        }

        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if !is_dir {
            // A `.lock` file rather than directory (e.g. a proper-lockfile
            // guard remnant). The daemon manages guard lockfile staleness
            // itself; removing one here could race an active daemon, so keep.
            summary.kept += 1;
            continue;
        }

        let owner_pid = read_lease_owner_pid(&path);
        // `u64::MAX` age on unreadable metadata -> past grace, but the dead-PID
        // check still gates the removal, so an unreadable lease is never
        // deleted merely because its age is unknown.
        let age_ms = dir_age_ms(&path, now).unwrap_or(u64::MAX);
        if classify_stale_lease(owner_pid, age_ms, grace_ms, pid_alive) {
            if fs::remove_dir_all(&path).is_ok() {
                summary.stale_leases_removed += 1;
            }
        } else {
            summary.kept += 1;
        }
    }

    summary
}

/// Windows liveness oracle. Returns `true` when the PID is alive, `true` when
/// it cannot be determined (conservative), and `false` only when the PID is
/// provably gone.
#[cfg(windows)]
pub fn pid_alive(pid: u32) -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, ERROR_INVALID_PARAMETER, STILL_ACTIVE};
    use windows_sys::Win32::System::Threading::{GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};

    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if !handle.is_null() {
            let mut code = 0u32;
            let ok = GetExitCodeProcess(handle, &mut code);
            CloseHandle(handle);
            // Query failed -> assume alive (never delete on uncertainty).
            if ok == 0 {
                return true;
            }
            return code == STILL_ACTIVE as u32;
        }
        // OpenProcess failed. ERROR_INVALID_PARAMETER means "no such process";
        // anything else (e.g. access denied) means the process likely exists.
        GetLastError() != ERROR_INVALID_PARAMETER
    }
}

/// Non-Windows liveness oracle: no PID API, so always report alive (the sweep
/// then never reclaims). Sophos is Windows-native; this keeps the crate
/// compiling on other hosts without weakening the safety rule.
#[cfg(not(windows))]
pub fn pid_alive(_pid: u32) -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_dead_old_lease_as_stale() {
        let dead = |_pid: u32| false;
        assert!(classify_stale_lease(Some(123), 2 * 60 * 60 * 1000, 60 * 60 * 1000, &dead));
    }

    #[test]
    fn keeps_lease_still_inside_grace() {
        let dead = |_pid: u32| false;
        assert!(!classify_stale_lease(Some(123), 30 * 60 * 1000, 60 * 60 * 1000, &dead));
    }

    #[test]
    fn keeps_lease_with_live_owner() {
        let alive = |_pid: u32| true;
        assert!(!classify_stale_lease(Some(123), 2 * 60 * 60 * 1000, 60 * 60 * 1000, &alive));
    }

    #[test]
    fn keeps_lease_with_unknown_owner() {
        let dead = |_pid: u32| false;
        assert!(!classify_stale_lease(None, 2 * 60 * 60 * 1000, 60 * 60 * 1000, &dead));
    }

    #[test]
    fn grace_boundary_is_strictly_greater() {
        let dead = |_pid: u32| false;
        // Exactly at the grace window is still kept (strictly greater).
        assert!(!classify_stale_lease(Some(123), 60 * 60 * 1000, 60 * 60 * 1000, &dead));
    }

    #[test]
    fn recognizes_leftover_names() {
        assert!(is_lease_leftover("abc.lock.stale-1234-uuid"));
        assert!(is_lease_leftover("abc.lock.candidate-5678-x"));
        assert!(!is_lease_leftover("abc.lock"));
        assert!(!is_lease_leftover("owner.json"));
    }
}
