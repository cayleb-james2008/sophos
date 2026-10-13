# Sophos and upstream Prime Agent

Sophos is a graphical interface and enhanced interpretation of the original
Prime Agent concept for Windows. [Prime Intellect's Prime Agent](https://github.com/PrimeIntellect-ai/prime-agent)
supplies the agent runtime, daemon and bridge. Sophos pins the public v0.7.0
source, retains its MIT notice, and adds the desktop shell, views, packaging
and reliability work described here. These additions do not establish
independent authorship of the upstream agent engine.

This account describes the implemented desktop capabilities after baseline
`48d6cbdc011fcf762a872f1353f926419c994e29` (2026-10-08).
[PR #20 checks](https://github.com/cayleb-james2008/sophos/pull/20/checks) record
the hosted Windows results for the corresponding source head. Earlier issue counts, visual scores, and
installed-runtime claims are dated records, not current acceptance results;
the original text remains in Git history and the research remains in
`research/`.

## What the desktop adds

| Surface | Source-backed behavior | Evidence boundary |
|---|---|---|
| Sessions and transcripts | Sophos exposes daemon-backed sessions and persisted transcripts, with session state available again after restart. | Local source tests cover these paths; they do not establish live provider inference or a new Windows release. |
| Profiles and local models | Saved profiles persist; their instructions are added to new-session prompts. Loopback model discovery registers models in the daemon catalog. | Tool, skill, and safety selections are descriptive UI metadata. Catalog registration does not prove that a model can complete live inference. |
| Context budget and compaction | The panel reads measured token totals from the active daemon session and calls the daemon's semantic compactor. | Per-tier estimates are not reported. The daemon may not return before/after totals; savings remain unknown until a later model response. Prune/evict controls are unavailable outside demo mode. |
| Advanced panels | Code Mode, MCP access, CUA/UIA actions, workspace-security policy, squad workflows, thought-tree operations, distilled-skill mutation, workspace twins, and checkpoint restore are not native capabilities in this build. | The bridge explicitly rejects unsupported operations. Related panels and program cards are UI previews, not evidence that those actions ran. |
| Profile safety and refinement UI | Profile Studio saves profile text and shows composition previews; refinement events can be displayed. | Tool/safety toggles do not enforce permissions, and Apply/Discard controls are not a verified native approval gate. Sophos is not a security sandbox. |
| Runtime, packaging and attribution | The Rust shell and bundler stage the pinned upstream runtime and preserve its MIT notice. | Hosted checks are linked above. A candidate MSI build is not an install; the signed public updater-feed package is not proven to contain this source revision. Windows is the supported product target; macOS/Linux and all Windows versions are not certified. |

The current source passed 1,224 Vitest tests across 147 files, 82 Node
tests, and eight Rust lease tests locally. This is source-tree evidence only;
current-source installer acceptance and live provider inference remain separate. The source does include real session/profile persistence,
loopback model registration, and daemon-backed semantic compaction.

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

The historical baseline's
[Windows CI run 37765204065](https://github.com/cayleb-james2008/sophos/actions/runs/37765204065)
passed 1,126 frontend tests, seven native containment regressions, staged and
standalone lifecycle checks (50/50 each), and eight CUA demo suites. Three
keyboard subchecks were skipped because background WebView2 input delivery
was unreliable. The public-package console check includes a no-op placeholder,
so it is not independent proof of a clean console.

Current-source MSI installation, real provider inference, native UI/CUA and
security acceptance, broader compatibility, and unresolved dependency audit
findings remain separate. Earlier failed or conflicting PR heads retain their
own status; a passing successor on master does not approve their unique
changes. Model-generated code runs with the user's permissions. Sophos is not
a security sandbox.
