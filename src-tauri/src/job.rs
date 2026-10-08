//! Windows Job Object — guarantees child processes die with the parent.
//!
//! A job object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` is created once at
//! startup and every child (daemon, sidecar) is assigned to it. When the job
//! handle is closed — on normal app exit (Drop) or when the OS tears down the
//! process on a hard kill — all assigned children are terminated. This is the
//! containment boundary for the daemon, sidecar and their descendants.
//! Children start suspended and run only after assignment succeeds. Creation,
//! configuration, assignment and resume errors fail closed, never to a null job.

use std::io;
use std::os::windows::io::AsRawHandle;
use std::os::windows::process::CommandExt;
use std::process::{Child, Command};

use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Thread32First, Thread32Next, TH32CS_SNAPTHREAD, THREADENTRY32,
};
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};
use windows_sys::Win32::System::Threading::{
    OpenThread, ResumeThread, CREATE_NO_WINDOW, CREATE_SUSPENDED, THREAD_SUSPEND_RESUME,
};

struct OwnedHandle(HANDLE);

impl Drop for OwnedHandle {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
}

/// A Windows job object that kills its assigned processes when dropped.
pub struct Job {
    handle: HANDLE,
}

impl Job {
    /// Create a job object with `KILL_ON_JOB_CLOSE`, preserving the OS error.
    pub fn new() -> io::Result<Self> {
        Self::create_with(
            || unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) },
            |handle, info| unsafe {
                SetInformationJobObject(
                    handle,
                    JobObjectExtendedLimitInformation,
                    info as *const _ as *const _,
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                )
            },
        )
    }

    fn create_with(
        create: impl FnOnce() -> HANDLE,
        configure: impl FnOnce(HANDLE, &JOBOBJECT_EXTENDED_LIMIT_INFORMATION) -> i32,
    ) -> io::Result<Self> {
        unsafe {
            let handle = create();
            if handle.is_null() {
                return Err(io::Error::last_os_error());
            }
            let owned = OwnedHandle(handle);
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let ok = configure(handle, &info);
            if ok == 0 {
                return Err(io::Error::last_os_error());
            }
            std::mem::forget(owned);
            Ok(Job { handle })
        }
    }

    fn assign(&self, child: &Child) -> io::Result<()> {
        if unsafe { AssignProcessToJobObject(self.handle, child.as_raw_handle()) } == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }

    /// Spawn without letting user code run before hard-kill containment exists.
    /// Owns the GUI child's Windows creation flags; callers configure args/stdio.
    pub fn spawn(&self, command: &mut Command) -> io::Result<Child> {
        self.spawn_with(command, |child| self.assign(child), resume_primary_thread)
    }

    fn spawn_with(
        &self,
        command: &mut Command,
        assign: impl FnOnce(&Child) -> io::Result<()>,
        resume: impl FnOnce(&Child) -> io::Result<()>,
    ) -> io::Result<Child> {
        command.creation_flags(CREATE_NO_WINDOW | CREATE_SUSPENDED);
        let mut child = command.spawn()?;
        if let Err(error) = assign(&child).and_then(|()| resume(&child)) {
            // The child has not executed its payload, so it cannot have escaped
            // by spawning descendants. Never publish its pipes or ownership.
            if let Err(kill_error) = child.kill() {
                if !matches!(child.try_wait(), Ok(Some(_))) {
                    return Err(io::Error::new(
                        error.kind(),
                        format!(
                            "child containment failed: {error}; terminate failed: {kill_error}"
                        ),
                    ));
                }
            }
            if let Err(wait_error) = child.wait() {
                return Err(io::Error::new(
                    error.kind(),
                    format!("child containment failed: {error}; reap failed: {wait_error}"),
                ));
            }
            return Err(io::Error::new(
                error.kind(),
                format!("child containment failed: {error}"),
            ));
        }
        Ok(child)
    }
}

/// std::process retains the process handle but closes the initial thread handle.
/// A CREATE_SUSPENDED child has one initial thread and cannot execute user code
/// or create others. Recover that thread using documented Win32 APIs, requiring
/// exactly one match; any snapshot/open/resume anomaly fails closed.
fn resume_primary_thread(child: &Child) -> io::Result<()> {
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
        if snapshot == INVALID_HANDLE_VALUE {
            return Err(io::Error::last_os_error());
        }
        let snapshot = OwnedHandle(snapshot);
        let mut entry: THREADENTRY32 = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<THREADENTRY32>() as u32;
        if Thread32First(snapshot.0, &mut entry) == 0 {
            return Err(io::Error::last_os_error());
        }
        let mut thread_id = None;
        loop {
            if entry.th32OwnerProcessID == child.id() {
                if thread_id.replace(entry.th32ThreadID).is_some() {
                    return Err(io::Error::other("suspended child has multiple threads"));
                }
            }
            if Thread32Next(snapshot.0, &mut entry) == 0 {
                // ERROR_NO_MORE_FILES is the only successful end-of-snapshot.
                let error = io::Error::last_os_error();
                if error.raw_os_error() != Some(18) {
                    return Err(error);
                }
                break;
            }
        }
        let thread_id =
            thread_id.ok_or_else(|| io::Error::other("suspended child thread missing"))?;
        let thread = OpenThread(THREAD_SUSPEND_RESUME, 0, thread_id);
        if thread.is_null() {
            return Err(io::Error::last_os_error());
        }
        let thread = OwnedHandle(thread);
        let previous_count = ResumeThread(thread.0);
        if previous_count == u32::MAX {
            return Err(io::Error::last_os_error());
        }
        if previous_count != 1 {
            return Err(io::Error::other(format!(
                "unexpected suspension count: {previous_count}"
            )));
        }
        Ok(())
    }
}

impl Drop for Job {
    fn drop(&mut self) {
        if !self.handle.is_null() {
            unsafe {
                CloseHandle(self.handle);
            }
        }
    }
}

// The job handle is only used for `AssignProcessToJobObject` and `CloseHandle`,
// both of which are thread-safe. Marking the wrapper Send/Sync lets it be
// shared across the health-monitor and sidecar-reader threads.
unsafe impl Send for Job {}
unsafe impl Sync for Job {}

#[cfg(test)]
#[path = "../../verify/job-containment/job-tests.rs"]
mod tests;
