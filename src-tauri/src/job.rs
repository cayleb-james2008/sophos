//! Windows Job Object — guarantees child processes die with the parent.
//!
//! A job object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` is created once at
//! startup and every child (daemon, sidecar) is assigned to it. When the job
//! handle is closed — on normal app exit (Drop) or when the OS tears down the
//! process on a hard kill — all assigned children are terminated. This is the
//! production-grade guarantee that no daemon/sidecar is orphaned on exit.

use std::os::windows::io::AsRawHandle;
use std::process::Child;

use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, SetInformationJobObject,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    JobObjectExtendedLimitInformation,
};

/// A Windows job object that kills its assigned processes when dropped.
pub struct Job {
    handle: HANDLE,
}

impl Job {
    /// Create a job object with `KILL_ON_JOB_CLOSE`. Returns `None` on failure.
    pub fn new() -> Option<Self> {
        unsafe {
            let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if handle.is_null() {
                return None;
            }
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let ok = SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const _,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            if ok == 0 {
                CloseHandle(handle);
                return None;
            }
            Some(Job { handle })
        }
    }

    /// Assign a child process to this job. Returns true on success.
    pub fn assign(&self, child: &Child) -> bool {
        if self.handle.is_null() {
            return false;
        }
        unsafe { AssignProcessToJobObject(self.handle, child.as_raw_handle()) != 0 }
    }

    /// A no-op job used when job-object creation fails.
    pub fn null() -> Self {
        Job {
            handle: std::ptr::null_mut(),
        }
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
