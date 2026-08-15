# Sophos v0.4.0 (Beta)

> **⚠️ Beta Release**
>
> This is a **pre-v1.0 beta release**. All versions before v1.0 are beta. The
> auto-updater channel is labeled `beta`, and the update feed manifest carries
> a `"channel": "beta"` field so the release channel is visible to anyone
> inspecting the endpoint. Expect rough edges; report issues via the
> [issue tracker](https://gitlab.com/caylebalvarez-james/sophos/-/issues).

**Summary:** Pre-v1.0 beta release. All versions before v1.0 are beta.

---

## What's New

This release lands the **beta labeling** across all surfaces:

- The auto-updater feed (`manifest.json`) is labeled as the `beta` channel.
- The local update-feed dev server now defaults to `0.4.0` and supports a
  `--channel` argument (default `beta`) that is reflected in the manifest's
  `notes` and `channel` fields.
- Version strings across the app (`package.json`, `tauri.conf.json`,
  `Cargo.toml`) now read `0.4.0`.

For the full list of features and changes, see the
[CHANGELOG](https://gitlab.com/caylebalvarez-james/sophos/-/blob/master/CHANGELOG.md).

## Known Issues

- The v0.4.0 installer binary is **not yet built and signed** — the auto-updater
  manifest points at the last signed stable build (v0.2.0) until the v0.4.0
  installer is rebuilt and re-signed. New installs should use the v0.2.0
  installer for now; the v0.4.0 binary will be published when it is ready.
- As a pre-v1.0 beta, some features may be incomplete or subject to change.

## Installation

Download the installer from the GitLab release assets:

- **Windows x64 installer:**
  [Sophos_0.4.0_x64-setup.exe](https://gitlab.com/api/v4/projects/caylebalvarez-james%2Fsophos/packages/generic/sophos/0.4.0/Sophos_0.4.0_x64-setup.exe)

Or build from source — see
[CONTRIBUTING.md](https://gitlab.com/caylebalvarez-james/sophos/-/blob/master/CONTRIBUTING.md).

**Release page:** https://gitlab.com/caylebalvarez-james/sophos/-/releases/0.4.0
