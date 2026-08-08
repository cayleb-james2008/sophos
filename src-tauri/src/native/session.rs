//! `native_session_scan` — scan a session directory for saved sessions.

use std::fs;
use std::path::Path;

use crate::contract::SessionInfo;

/// Scan `dir` for saved sessions (subdirectories or `.json`/`.jsonl` files),
/// newest first.
pub fn scan(dir: &str) -> Result<Vec<SessionInfo>, String> {
    let path = Path::new(dir);
    let entries = fs::read_dir(path).map_err(|e| format!("failed to read session dir: {e}"))?;

    let mut sessions = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| format!("failed to read entry: {e}"))?;
        let p = entry.path();
        let is_session = p.is_dir()
            || p.extension()
                .map(|e| e == "json" || e == "jsonl")
                .unwrap_or(false);
        if !is_session {
            continue;
        }

        let name = p
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        let updated_at = entry
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .map(|t| format_iso(t));

        sessions.push(SessionInfo {
            id: name.clone(),
            title: Some(name),
            cwd: Some(dir.to_string()),
            created_at: None,
            updated_at,
            status: Some("saved".to_string()),
        });
    }

    sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(sessions)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scans_json_and_dirs() {
        let dir = std::env::temp_dir().join(format!("pa-scan-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("session-a")).unwrap();
        std::fs::write(dir.join("session-b.json"), "{}").unwrap();
        std::fs::write(dir.join("notes.txt"), "ignored").unwrap();

        let sessions = scan(dir.to_str().unwrap()).unwrap();
        let ids: Vec<&str> = sessions.iter().map(|s| s.id.as_str()).collect();
        assert!(ids.contains(&"session-a"));
        assert!(ids.contains(&"session-b.json"));
        assert!(!ids.contains(&"notes.txt"));

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn missing_dir_errors() {
        let bad = std::env::temp_dir().join("pa-scan-does-not-exist-xyz");
        assert!(scan(bad.to_str().unwrap()).is_err());
    }
}

/// Format a `SystemTime` as ISO 8601 UTC (`YYYY-MM-DDTHH:MM:SSZ`).
fn format_iso(t: std::time::SystemTime) -> String {
    let secs = match t.duration_since(std::time::UNIX_EPOCH) {
        Ok(d) => d.as_secs() as i64,
        Err(e) => -(e.duration().as_secs() as i64),
    };
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let (y, m, d) = civil_from_days(days);
    let hh = rem / 3600;
    let mm = (rem % 3600) / 60;
    let ss = rem % 60;
    format!("{y:04}-{m:02}-{d:02}T{hh:02}:{mm:02}:{ss:02}Z")
}

/// Convert days since 1970-01-01 to a (year, month, day) civil date.
/// Howard Hinnant's `civil_from_days` algorithm.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m as u32, d as u32)
}
