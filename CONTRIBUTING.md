# Contributing to Sophos

Sophos is a Windows-native desktop port of Prime Intellect's Prime Agent,
built with Vite + React + TypeScript and packaged with Tauri. This document
covers how to build from source, run tests, keep the codebase consistent, and
submit changes.

## Table of contents

- [Building from source](#building-from-source)
- [Testing](#testing)
- [Code style](#code-style)
- [PR process](#pr-process)

## Building from source

### Prerequisites

- **Node.js 22+** and npm 10+.
- **Rust toolchain** (stable) and the platform prerequisites for
  [Tauri v2](https://v2.tauri.app/start/prerequisites/) (MSVC Build Tools and
  WebView2 on Windows).

### Setup

Install the locked frontend dependencies from the repository root:

```sh
npm ci
```

The Prime Agent runtime is a pinned public source dependency, not an npm
package tarball. `node scripts/bundle.mjs` clones/validates the exact v0.7.0
commit into ignored `.deps/prime-agent`, installs its lockfile with normal npm
lifecycle scripts, builds the daemon and bridge, and stages the verified
runtime. No machine-local AppData checkout is required.

### Development

Run the Vite dev server (Tauri expects it on a fixed port):

```sh
npm run dev
```

Launch the full desktop app from a Tauri dev build:

```sh
npm run tauri dev
```

### Production build

```sh
npm ci                  # frontend dependencies
node scripts/bundle.mjs # pinned Prime Agent + bridge build and runtime staging
node verify/e2e.mjs     # real offline daemon/bridge protocol smoke test
npm run tauri build     # native desktop installer on Windows
```

The `verify/` suite requires a bundled runtime. Build it first with
`node scripts/bundle.mjs`, then run the verifiers (see Testing).

## Testing

Unit / component tests run on **Vitest** with jsdom and React Testing Library.

```sh
npm test             # run once (CI mode), exits non-zero on failure
npx vitest run       # same as npm test
npm run test:watch   # watch mode for development
npm run test:ui      # interactive Vitest UI (requires @vitest/ui)
```

Test files live next to the code they cover as `src/**/*.test.{ts,tsx}`, and
share a global setup at `src/test/setup.ts` (imports `@testing-library/jest-dom`
for matchers). The `@/` path alias is configured in `vitest.config.ts`, so
tests import exactly like source code. `npm run test:ui` requires the optional
`@vitest/ui` package (`npm i -D @vitest/ui`); without it, use `npm test` or
`npm run test:watch`.

**What is covered:** the CI workflow installs from locked dependencies, builds
the pinned upstream daemon and TypeScript bridge from public source, stages the
hash-verified Node runtime, and runs the real offline bridge/daemon JSON-RPC
verifier (`node verify/e2e.mjs`). On Windows this exercises the named-pipe path
with the bundled Node executable; on Linux/macOS it uses the host Node and a
Unix-domain socket. Non-Windows results do not validate Windows-native setup.

### Verifiers

The `verify/` directory holds model-free offline checks. `node verify/e2e.mjs`
requires a freshly assembled `resources/` bundle and drives the real daemon
and bridge together, including reconnect recovery. It does not test provider
API access, TCP fallback, Tauri installer creation, or Windows behavior when
run on another OS.

## Code style

- **TypeScript strict.** `tsconfig.json` runs with `strict: true`,
  `noUnusedLocals`, `noUnusedParameters`, and `noFallthroughCasesInSwitch`.
  New code must compile under `npx tsc --noEmit` with no errors.
- **Design system tokens.** UI work uses the design-system tokens and
  primitives under `src/design/` rather than ad-hoc values. Reuse existing
  tokens/components before introducing new ones.
- **Imports.** Use the `@/` alias for imports into `src/`.
- **Formatting.** Keep changes consistent with the surrounding file; there is
  no separate formatter config, so match existing style.

## PR process

1. **Fork** the repository (or work on a feature branch off `master` for
   direct contributors).
2. **Branch.** Create a short, descriptive branch, e.g.
   `feat/session-persistence` or `fix/named-pipe-fallback`.
3. **Develop.** Keep changes scoped and follow the code style above. Prefer
   small, reviewable commits with clear messages.
4. **Test before you submit.** Run `npx tsc --noEmit` and `npm test` locally;
   both must pass.
5. **Open a pull request** against `master`. Describe what the change does and
   why, and note any manual verification performed.
6. **CI must pass.** The workflow builds the full pinned runtime from a fresh
   source checkout and runs the daemon/bridge end-to-end verifier as a required
   Windows job. The CUA UI job remains best-effort because GitHub-hosted Windows
   runners do not provide an interactive desktop session.

Thank you for contributing to Sophos.
