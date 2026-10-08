# Sophos and upstream Prime Agent

Sophos is a graphical interface and enhanced interpretation of the original
Prime Agent concept for Windows. [Prime Intellect's Prime Agent](https://github.com/PrimeIntellect-ai/prime-agent)
supplies the agent runtime, daemon and bridge. Sophos pins the public v0.7.0
source, retains its MIT notice, and adds the desktop shell, views, packaging
and reliability work described here. These additions do not establish
independent authorship of the upstream agent engine.

This account is based on merged source
`48d6cbdc011fcf762a872f1353f926419c994e29` (2026-10-08). The earlier version
of this document described dated research and development snapshots. Its
issue counts, visual scores and installed-runtime claims are historical
records, not current acceptance results. The original text remains in Git
history; the underlying research remains in `research/`.

## What the desktop adds

| Surface | Source-backed behavior | Evidence boundary |
|---|---|---|
| Windows desktop shell | Tauri/Rust hosts the React interface and manages the packaged Node daemon and bridge. | Windows is the supported product target. Source guards and hosted Windows tests do not certify macOS/Linux desktop support or all Windows versions. |
| Sessions and agents | Graphical views expose sessions, agent children, details and relevant actions through the bridge. | Frontend tests and demo CUA exercise the interface. A populated demo is simulated IPC, not a live provider session. |
| Setup and provider controls | Onboarding, Settings and provider controls make runtime setup accessible through the interface. | Provider choices and OAuth UI do not prove successful authentication or inference for every provider. |
| Refinement review | Client controls present refinement proposals and Apply/Discard actions. | The client gate is not a security sandbox or a certificate for every upstream refinement path. |
| Runtime reliability | The shell uses hidden child-process startup and fail-closed Windows job containment; recovery and cancellation have regression coverage. | Tests cover assigned processes and descendants. A hard kill between process creation and job assignment can leave a suspended process; hostile same-user interference is outside the verified guarantee. |
| Packaging and attribution | Build tooling stages the pinned upstream runtime and checks the embedded MIT notice. | Building a candidate MSI is separate from installing it. The signed public updater-feed package is not proven to contain this exact source revision. |

The corresponding source is in `src/features/`, `src-tauri/src/`, `bridge/`
and `scripts/`. The [README verification status](../README.md#verification-status)
links the exact CI evidence and preserves earlier failed runs and their limits.

## Corrections to the historical claims

- **Python selection:** `src-tauri/src/daemon.rs` deliberately avoids injecting
  `PRIME_AGENT_KERNEL_PYTHON`; the pinned daemon selects its interpreter. When
  a connected daemon lacks the optional kernel-state API,
  `bridge/src/kernel-state-compat.ts` returns no metadata. The shell must not
  infer a live interpreter from transcript contents or available tools.
- **Installers:** the hosted workflow builds the current-source guarded MSI
  and checks compatibility and notices. Its public-installer smoke concerns
  the separately published updater-feed executable. It does not prove that
  the current-source MSI was installed or that the feed matches this tree.
- **Shell prerequisites:** bundling Node does not remove every development or
  upstream tool prerequisite. The README still lists Git for Windows among
  the daemon prerequisites; Git Bash removal is not an established feature.
- **Live behavior and scores:** historical scripts, screenshots and research
  scores do not make every product claim verified today. No live provider
  session, account, spend, production readiness or universal compatibility is
  established by this document.

## Current verification and remaining limits

The exact baseline's
[Windows CI run 37765204065](https://github.com/cayleb-james2008/sophos/actions/runs/37765204065)
passed 1,126 frontend tests, seven native containment regressions, staged and
standalone lifecycle checks (50/50 each), and eight CUA demo suites. Three
keyboard subchecks were skipped because background WebView2 input delivery
was unreliable. The public-package console check includes a no-op placeholder,
so it is not independent proof of a clean console.

Current-source MSI installation, real provider inference, broader native
compatibility and unresolved dependency audit findings remain separate work.
Earlier failed or conflicting PR heads retain their own status; a passing
successor on master does not approve their unique changes. Model-generated
code runs with the user's permissions. Sophos is not a security sandbox.
