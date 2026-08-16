# GitLab Release Preparation — Sophos v0.6.0

**Date:** 2026-08-16
**Status:** Ready to publish — all artifacts built and verified.

---

## Artifacts

| Artifact | Path | Size |
|---|---|---|
| NSIS installer | `src-tauri/target/release/bundle/nsis/Sophos_0.6.0_x64-setup.exe` | 98,194,623 bytes (98 MB) |
| Signature | `src-tauri/target/release/bundle/nsis/Sophos_0.6.0_x64-setup.exe.sig` | 416 bytes |
| Manifest | `public/manifest.json` | 941 bytes |
| Release notes | `docs/release-notes-v0.6.0.md` | 6,603 bytes |
| CHANGELOG | `CHANGELOG.md` (v0.6.0 section) | updated |

## Verification

- ✅ Version is 0.6.0 in `package.json`, `tauri.conf.json`, `Cargo.toml`
- ✅ Installer exists: `Sophos_0.6.0_x64-setup.exe` (98 MB)
- ✅ Signature exists: `Sophos_0.6.0_x64-setup.exe.sig` (416 bytes, Ed25519)
- ✅ Manifest is valid JSON, version 0.6.0, signature matches .sig file, URL points at GitLab package registry
- ✅ CHANGELOG has v0.6.0 section with all fixes
- ✅ Release notes document all 12 bugs found and fixed during the cua-driver testing pass

## Steps to publish the GitLab release

### 1. Commit and push to main

```bash
cd C:\Users\Cayleb\Desktop\workspace\sophos
git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml CHANGELOG.md docs/release-notes-v0.6.0.md public/manifest.json dist/manifest.json
git commit -m "release(v0.6.0): bump version, signed installer, manifest, release notes"
git push origin main
```

### 2. Upload the installer to the GitLab package registry

```bash
# Upload the NSIS installer as a generic package
curl --header "JOB-TOKEN: ${CI_JOB_TOKEN}" \
     --upload-file src-tauri/target/release/bundle/nsis/Sophos_0.6.0_x64-setup.exe \
     "https://gitlab.com/api/v4/projects/85429532/packages/generic/sophos/0.6.0/Sophos_0.6.0_x64-setup.exe"
```

Or using a personal access token:

```bash
curl --header "PRIVATE-TOKEN: <your-token>" \
     --upload-file src-tauri/target/release/bundle/nsis/Sophos_0.6.0_x64-setup.exe \
     "https://gitlab.com/api/v4/projects/85429532/packages/generic/sophos/0.6.0/Sophos_0.6.0_x64-setup.exe"
```

### 3. Create the GitLab release

```bash
# Create the release with release notes
curl --request POST \
     --header "PRIVATE-TOKEN: <your-token>" \
     --data '{
       "name": "Sophos v0.6.0 (Beta)",
       "tag_name": "v0.6.0",
       "description": "See docs/release-notes-v0.6.0.md",
       "assets": {
         "links": [
           {
             "name": "Sophos_0.6.0_x64-setup.exe",
             "url": "https://gitlab.com/api/v4/projects/85429532/packages/generic/sophos/0.6.0/Sophos_0.6.0_x64-setup.exe",
             "link_type": "package"
           }
         ]
       }
     }' \
     "https://gitlab.com/api/v4/projects/85429532/releases"
```

### 4. Push the manifest to the update-feed branch

The auto-updater endpoint reads from the `update-feed` branch's `public/manifest.json`:

```bash
# Switch to the update-feed branch and push the updated manifest
git stash
git checkout update-feed
git checkout main -- public/manifest.json
git add public/manifest.json
git commit -m "chore(updater): publish v0.6.0 manifest"
git push origin update-feed
git checkout main
git stash pop  # if needed
```

### 5. Verify the update feed

```bash
# Check the manifest is live
curl -s https://gitlab.com/caylebalvarez-james/sophos/-/raw/update-feed/public/manifest.json | node -e "process.stdin.on('data',d=>{const m=JSON.parse(d);console.log('version:',m.version);console.log('url:',m.platforms['windows-x86_64'].url)})"
```

Expected output:
```
version: 0.6.0
url: https://gitlab.com/api/v4/projects/85429532/packages/generic/sophos/0.6.0/Sophos_0.6.0_x64-setup.exe
```