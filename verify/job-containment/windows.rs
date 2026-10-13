// Compile the production boundary, not a copy or mocked implementation.
#[cfg(not(windows))]
compile_error!("Native job-containment acceptance requires Windows, not a zero-test POSIX pass");
#[cfg(windows)]
#[path = "../../src-tauri/src/job.rs"]
mod job;
