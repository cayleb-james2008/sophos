# GitLab Release — Sophos v0.8.0 (draft)

**Date:** 2026-08-17
**Status:** Artifacts built, signed, and verified locally. Publishing (upload + release create + feed push) is the remaining operator step — it needs a GitLab token.

---

## Artifacts

| Artifact | Path | Size | SHA-256 |
|---|---|---|---|
| NSIS installer | `src-tauri/target/release/bundle/nsis/Sophos_0.8.0_x64-setup.exe` | 98,213,279 bytes (98.2 MB) | `6f604896bca5d670898578979f5d58bbf47ea7cfe12339915bb65a349af66e46` |
| Updater signature | `src-tauri/target/release/bundle/nsis/Sophos_0.8.0_x64-setup.exe.sig` | 416 bytes | (minisign Ed25519) |
| MSI installer | `src-tauri/target/release/bundle/msi/Sophos_0.8.0_x64_en-US.msi` | 168,779,745 bytes (168.8 MB) | `95b942ff0c8134218d65563187ebac375d4a9cda467c89ef30a95b65f041b75d` |
| Update manifest | `public/manifest.json` | v0.8.0 | signature verifies over the installer |
| Release notes | `docs/release-notes-v0.8.0.md` | — | — |
| CHANGELOG | `CHANGELOG.md` (v0.8.0 section) | — | — |

The NSIS build completed end-to-end (`npm run tauri build`, exit 0) — the documented `makensis` MAX_PATH blocker did **not** trigger from this worktree (~221-char staged path, under the 260 limit; see README → Troubleshooting).

## Verification done (local, fresh)

- ✅ Version is 0.8.0 in `package.json`, `tauri.conf.json`, `Cargo.toml` (+ `Cargo.lock`).
- ✅ `npm run tauri build` produced both the NSIS and MSI bundles (exit 0).
- ✅ Installer signed with the production key → `.sig` (416 bytes).
- ✅ `public/manifest.json` updated to 0.8.0; its `signature` verifies over the local installer with the configured pubkey (minisign Ed25519 over Blake2b-512), key id matches, tamper-rejection confirmed.
- ✅ `npm run test:live-feed` passes against the **current** live feed (0.7.2, 20/20 checks) — the 0.8.0 manifest will pass identically once pushed.
- ✅ Static gates green: `tsc --noEmit` (frontend + bridge), `vitest` 1119, `eslint --max-warnings 0`, `prettier --check`, `cargo test` 25.
- ✅ `npm run test:updater` passes both locally (35/35, with key) and in a CI-simulated checkout (34/34, no key — fixed; see "CI fix" below).
- ✅ cua-driver e2e 8/8 suites green — run record `verify/cua/e2e-run-0.8.0.md`.

## Publish steps (operator — needs `PRIVATE-TOKEN`)

### 1. Upload the installer to the GitLab package registry

```bash
curl --header "PRIVATE-TOKEN: <token>" \
     --upload-file src-tauri/target/release/bundle/nsis/Sophos_0.8.0_x64-setup.exe \
     "https://gitlab.com/api/v4/projects/85429532/packages/generic/sophos/0.8.0/Sophos_0.8.0_x64-setup.exe"
```

### 2. Create the GitLab release (installer + changelog attached)

```bash
curl --request POST \
     --header "PRIVATE-TOKEN: <token>" \
     --data '{
       "name": "Sophos v0.8.0 (Beta)",
       "tag_name": "v0.8.0",
       "description": "See docs/release-notes-v0.8.0.md (images must use absolute raw URLs, below).",
       "assets": {
         "links": [
           {
             "name": "Sophos_0.8.0_x64-setup.exe",
             "url": "https://gitlab.com/api/v4/projects/85429532/packages/generic/sophos/0.8.0/Sophos_0.8.0_x64-setup.exe",
             "link_type": "package"
           }
         ]
       }
     }' \
     "https://gitlab.com/api/v4/projects/85429532/releases"
```

Paste the ready-to-paste description from the section below — it embeds the screenshots as absolute `/-/raw/master/…` URLs, which is what actually renders on the release page (relative/local paths render as broken images).

### 3. Push the manifest to the update-feed branch

```bash
git checkout update-feed
git checkout master -- public/manifest.json
git add public/manifest.json
git commit -m "chore(updater): publish v0.8.0 manifest"
git push origin update-feed
git checkout master
```

Then re-run `npm run test:live-feed` — it must report `version=0.8.0` and PASS.

### 4. Tag + push the release commit

```bash
git tag v0.8.0 && git push origin v0.8.0
```

---

## Ready-to-paste release description (images fixed)

Copy this whole block into the GitLab release **description** field. The images use absolute `/-/raw/master/...` URLs, so they render on the release page (relative/local paths do not).

```markdown
Sophos v0.8.0 (Beta) — the quality-and-reliability release: enforced lint + format gate,
stale session-lease recovery, a written reliability-dispositions record, no untyped `any`,
and two real Rules-of-Hooks fixes — proven by 1119 unit tests, 25 Rust tests, and 8/8
green cua-driver end-to-end suites against the rebuilt release exe.

![Chat](https://gitlab.com/caylebalvarez-james/sophos/-/raw/master/verify/cua/screenshots/chat-send.png)
![Sessions](https://gitlab.com/caylebalvarez-james/sophos/-/raw/master/verify/cua/screenshots/sessions-graph.png)
![Agents](https://gitlab.com/caylebalvarez-james/sophos/-/raw/master/verify/cua/screenshots/agents-fleet.png)
![Inbox](https://gitlab.com/caylebalvarez-james/sophos/-/raw/master/verify/cua/screenshots/inbox-flow.png)
![Settings → About](https://gitlab.com/caylebalvarez-james/sophos/-/raw/master/verify/cua/screenshots/settings-about.png)
![Engine terminal](https://gitlab.com/caylebalvarez-james/sophos/-/raw/master/verify/cua/screenshots/shell-engine.png)
![Profile Studio](https://gitlab.com/caylebalvarez-james/sophos/-/raw/master/verify/cua/screenshots/studio-created.png)

**Full release notes:** [`docs/release-notes-v0.8.0.md`](https://gitlab.com/caylebalvarez-james/sophos/-/blob/master/docs/release-notes-v0.8.0.md)  
**Changelog:** [`CHANGELOG.md`](https://gitlab.com/caylebalvarez-james/sophos/-/blob/master/CHANGELOG.md)
```

---

## CI fix (why MRs/PRs were red)

The blocking `npm run test:updater` step required `scripts/updater.key` — the **private** signing key, which is gitignored and absent from CI — so every MR/PR failed at "Private key exists". Fixed in `verify/updater-test.mjs`:

- The private key check is now informational when the key is absent (CI).
- Fresh signing runs only when the key exists (local release machine).
- Without the key, the crypto verification runs against a **committed fixture** (`verify/fixtures/update-test.bin` + `.sig`) signed with the production key, so the Ed25519/minisign verification path is still exercised in CI against the real pubkey.

Verified: local run 35/35, CI-simulated (key removed) 34/34.
