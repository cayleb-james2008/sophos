use super::*;
use std::fs;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};
use windows_sys::Win32::Foundation::{GetHandleInformation, SetLastError, WAIT_OBJECT_0};
use windows_sys::Win32::System::Threading::{
    OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE,
};

static NEXT: AtomicU64 = AtomicU64::new(0);

struct FixtureDir(PathBuf);
impl FixtureDir {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "sophos-job-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::SeqCst)
        ));
        fs::create_dir(&root).unwrap();
        Self(root)
    }
    fn command(&self, mode: &str) -> Command {
        let mut cmd = Command::new(
            option_env!("CARGO_BIN_EXE_job-fixture")
                .expect("run the standalone Windows integration-test crate"),
        );
        cmd.arg(mode)
            .arg(&self.0)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        cmd
    }
    fn pid(&self, mode: &str) -> u32 {
        let deadline = Instant::now() + Duration::from_secs(15);
        loop {
            if let Ok(text) = fs::read_to_string(self.0.join(format!("{mode}.pid"))) {
                if let Ok(pid) = text.parse() {
                    return pid;
                }
            }
            assert!(
                Instant::now() < deadline,
                "fixture {mode} did not become ready"
            );
            std::thread::sleep(Duration::from_millis(20));
        }
    }
    fn assert_no_payload(&self) {
        assert_eq!(
            fs::read_dir(&self.0).unwrap().count(),
            0,
            "rejected suspended child must not execute or spawn descendants"
        );
    }
}
impl Drop for FixtureDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn process_handle(pid: u32) -> OwnedHandle {
    let handle = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, pid) };
    assert!(
        !handle.is_null(),
        "OpenProcess({pid}): {}",
        io::Error::last_os_error()
    );
    OwnedHandle(handle)
}
fn assert_exited(handle: &OwnedHandle) {
    assert_eq!(
        unsafe { WaitForSingleObject(handle.0, 5_000) },
        WAIT_OBJECT_0,
        "owned process/descendant did not terminate"
    );
}

#[test]
fn creation_failure_preserves_error_and_never_configures() {
    let result = Job::create_with(
        || unsafe {
            SetLastError(5);
            std::ptr::null_mut()
        },
        |_, _| panic!("creation failure must not configure or spawn"),
    );
    assert_eq!(result.err().unwrap().raw_os_error(), Some(5));
}

#[test]
fn configuration_failure_closes_created_handle() {
    let mut raw = std::ptr::null_mut();
    let result = Job::create_with(
        || unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) },
        |handle, info| {
            raw = handle;
            // A real Win32 failure: the extended-information buffer cannot be empty.
            unsafe {
                SetInformationJobObject(
                    handle,
                    JobObjectExtendedLimitInformation,
                    info as *const _ as *const _,
                    0,
                )
            }
        },
    );
    assert!(result.is_err());
    assert!(!raw.is_null());
    let mut flags = 0;
    assert_eq!(unsafe { GetHandleInformation(raw, &mut flags) }, 0);
    assert_eq!(io::Error::last_os_error().raw_os_error(), Some(6));
}

#[test]
fn rejected_assignment_terminates_and_reaps_before_payload() {
    let root = FixtureDir::new();
    // Native AssignProcessToJobObject fails with an invalid job handle.
    let invalid_job = Job {
        handle: std::ptr::null_mut(),
    };
    let mut process = None;
    let mut resumed = false;
    let result = invalid_job.spawn_with(
        &mut root.command("parent"),
        |child| {
            process = Some(process_handle(child.id()));
            // Spend time at the exact dangerous boundary; no payload may run.
            std::thread::sleep(Duration::from_millis(100));
            invalid_job.assign(child)
        },
        |_| {
            resumed = true;
            Ok(())
        },
    );
    assert!(result
        .unwrap_err()
        .to_string()
        .contains("child containment failed"));
    assert!(!resumed);
    assert_exited(process.as_ref().unwrap());
    root.assert_no_payload();
}

#[test]
fn resume_failure_terminates_and_reaps_assigned_child_before_payload() {
    let root = FixtureDir::new();
    let job = Job::new().unwrap();
    let mut process = None;
    let result = job.spawn_with(
        &mut root.command("parent"),
        |child| job.assign(child),
        |child| {
            process = Some(process_handle(child.id()));
            std::thread::sleep(Duration::from_millis(100));
            Err(io::Error::other("injected resume failure"))
        },
    );
    assert!(result
        .unwrap_err()
        .to_string()
        .contains("injected resume failure"));
    assert_exited(process.as_ref().unwrap());
    root.assert_no_payload();
}

#[test]
fn missing_executable_returns_spawn_error() {
    let root = FixtureDir::new();
    let job = Job::new().unwrap();
    assert!(job
        .spawn(&mut Command::new(root.0.join("missing.exe")))
        .is_err());
    root.assert_no_payload();
}

#[test]
fn dropping_job_kills_child_and_inherited_descendant() {
    let root = FixtureDir::new();
    let job = Job::new().unwrap();
    let mut child = job.spawn(&mut root.command("parent")).unwrap();
    assert_eq!(root.pid("parent"), child.id());
    let leaf = process_handle(root.pid("leaf"));
    drop(job);
    assert_exited(&leaf);
    assert!(child.wait().is_ok());
}

#[test]
fn hard_killing_owner_kills_child_and_inherited_descendant() {
    let root = FixtureDir::new();
    let mut owner = root.command("owner").spawn().unwrap();
    // RAII cleanup even if readiness or handle acquisition panics.
    struct OwnerGuard<'a>(&'a mut Child);
    impl Drop for OwnerGuard<'_> {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
    let owner = OwnerGuard(&mut owner);
    let parent = process_handle(root.pid("parent"));
    let leaf = process_handle(root.pid("leaf"));
    owner.0.kill().unwrap();
    owner.0.wait().unwrap();
    assert_exited(&parent);
    assert_exited(&leaf);
}
