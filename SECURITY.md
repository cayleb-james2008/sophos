# Security Policy

Sophos is a Windows-native desktop port of Prime Intellect's open-source
Prime Agent (Tauri v2 shell + Node bridge sidecar + React frontend),
currently in beta (v0.7.x). This policy describes how to report
vulnerabilities and what the project supports.

## Reporting a vulnerability

**Do not open a public issue for a security vulnerability.** Please report it
privately so it can be addressed before disclosure.

- **Preferred:** open a [confidential issue][confidential] on the project's
  GitLab repository, or email the maintainer at the contact address on the
  [project profile][profile].
- Include as much of the following as possible:
  - The affected component and version (or commit hash).
  - A description of the vulnerability and its impact.
  - Steps to reproduce, or a minimal proof of concept.
  - Any suggested fix, if you have one.

You will receive an acknowledgment within a few business days. We ask that you
give us a reasonable window to fix and release before disclosing publicly.

## Supported versions

Security fixes are applied to the current `main` branch and the latest tagged
release. Older beta releases are not backported unless a fix is trivial and
low-risk.

## Security-relevant areas

- `src-tauri/src/` — the Rust shell: process supervision (`daemon.rs`,
  `sidecar.rs`), runtime path resolution (`settings.rs`), and engine log
  capture (`engine_log.rs`).
- `bridge/src/` — the Node JSON-RPC sidecar between daemon and frontend.
- `scripts/bundle.mjs` — stages the runtime layout under `resources/`.
- `src-tauri/tauri.conf.json` — updater endpoint + signing pubkey.
- `*.key`, `*.pem`, `*.p12`, `.env` — secrets. These are gitignored and must
  never be committed.

## Reporting process

1. Report privately (see above).
2. Maintainers triage and confirm the report.
3. A fix is developed on a private branch, tested, and released.
4. The vulnerability is disclosed after the fix ships, with credit to the
   reporter unless they prefer anonymity.

[confidential]: https://gitlab.com/caylebalvarez-james/sophos/-/issues
[profile]: https://gitlab.com/caylebalvarez-james
