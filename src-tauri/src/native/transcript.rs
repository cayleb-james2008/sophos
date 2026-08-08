//! `native_transcript_parse` — parse a JSONL transcript file into messages.

use std::fs::File;
use std::io::{BufRead, BufReader};

use crate::contract::TranscriptMessage;

/// Parse a JSONL transcript (one `TranscriptMessage` per line) into a vector.
pub fn parse(path: &str) -> Result<Vec<TranscriptMessage>, String> {
    let file = File::open(path).map_err(|e| format!("failed to open transcript: {e}"))?;
    let reader = BufReader::new(file);
    let mut messages = Vec::new();
    for (idx, line) in reader.lines().enumerate() {
        let line = line.map_err(|e| format!("failed to read line {}: {e}", idx + 1))?;
        if line.trim().is_empty() {
            continue;
        }
        match serde_json::from_str::<TranscriptMessage>(&line) {
            Ok(msg) => messages.push(msg),
            Err(e) => return Err(format!("invalid JSONL at line {}: {e}", idx + 1)),
        }
    }
    Ok(messages)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_jsonl() {
        let dir = std::env::temp_dir().join(format!("pa-transcript-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("t.jsonl");
        std::fs::write(
            &path,
            "{\"id\":\"1\",\"role\":\"user\",\"content\":\"hi\"}\n\
             {\"id\":\"2\",\"role\":\"assistant\",\"content\":\"yo\",\"thinking\":\"hmm\"}\n",
        )
        .unwrap();

        let msgs = parse(path.to_str().unwrap()).unwrap();
        assert_eq!(msgs.len(), 2);
        assert_eq!(msgs[0].role, "user");
        assert_eq!(msgs[1].thinking.as_deref(), Some("hmm"));

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn rejects_bad_json() {
        let dir = std::env::temp_dir().join(format!("pa-transcript-bad-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("bad.jsonl");
        std::fs::write(&path, "not json\n").unwrap();
        assert!(parse(path.to_str().unwrap()).is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
