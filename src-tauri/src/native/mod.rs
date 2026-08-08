//! Native performance modules — pure-Rust implementations of the perf commands
//! exposed to the frontend. These run in-process (no sidecar round-trip).

pub mod markdown;
pub mod session;
pub mod token;
pub mod transcript;
