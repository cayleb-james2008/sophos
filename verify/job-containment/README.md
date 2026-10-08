# Windows job-containment regressions

Run on Windows with a Rust toolchain:

```text
cargo test --locked --manifest-path verify/job-containment/Cargo.toml --test windows -- --test-threads=1
```

The independent small crate imports the production `src-tauri/src/job.rs`;
it does not build Tauri or substitute a copy of the process boundary. Cargo
builds `job-fixture.exe` and exposes its exact path to the integration test.
A POSIX test invocation is deliberately rejected, rather than reporting a
zero-test native acceptance pass. Cross-target `cargo check --tests` on Linux
checks compilation only, not execution.

Seven checks cover injected creation failure (preserved OS error, no
configuration), a real configuration API failure (created handle closed), a
real assignment API rejection (suspended child killed/reaped, no payload or
descendant), injected resume failure after assignment (same cleanup), missing
executable, normal job drop (child and inherited descendant terminate), and
hard-killing the owning process (both descendants terminate). Process handles
are acquired before termination assertions so PID reuse cannot falsely pass.
Temporary marker directories and owned processes are cleaned up by RAII.

Only the fault scenarios that require injection use injected callbacks; those
callbacks are private and no runtime environment-variable bypass is provided.
The production path creates a suspended GUI child, assigns it to the configured
kill-on-close job, locates its one initial thread through documented Win32 APIs,
then resumes it. Snapshot/open/resume anomalies return an error and trigger
child cleanup. Both daemon and sidecar use this boundary before publishing
pipes or process ownership. Job creation/configuration errors abort app setup.

These checks do not establish paid inference, security against a same-user
hostile process, broad Windows-version compatibility, or a cause for the
historical shutdown trace. Full exact-head CI and independent review remain
required before publication.
