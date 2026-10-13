use std::fs;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::Duration;

#[cfg(windows)]
#[path = "../../src-tauri/src/job.rs"]
mod job;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let mode = &args[1];
    let root = PathBuf::from(&args[2]);
    let exe = std::env::current_exe().unwrap();
    #[cfg(windows)]
    if mode == "owner" {
        let job = job::Job::new().unwrap();
        let mut command = Command::new(&exe);
        command
            .arg("parent")
            .arg(&root)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let _child = job.spawn(&mut command).unwrap();
        // Keep the job open; the test force-kills this owner instead of Drop.
        loop {
            std::thread::sleep(Duration::from_secs(1));
        }
    }
    fs::write(
        root.join(format!("{mode}.pid")),
        std::process::id().to_string(),
    )
    .unwrap();
    let _child = if mode == "parent" {
        Some(
            Command::new(exe)
                .arg("leaf")
                .arg(&root)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .unwrap(),
        )
    } else {
        None
    };
    loop {
        std::thread::sleep(Duration::from_secs(1));
    }
}
