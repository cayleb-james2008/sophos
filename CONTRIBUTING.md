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

Install all frontend dependencies from the repository root:

```sh
npm install
```

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
npm run build      # tsc && vite build (frontend)
npm run tauri build # bundled desktop installer
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

**What is covered:** currently the unit-test harness and CI wiring are in
place; test files for individual features land as features are added. The CI
workflow additionally runs a TypeScript check and the headless end-to-end
verifier (`node verify/e2e.mjs`, which exercises the offline daemon protocol
and bridge sidecar on Windows).

### Verifiers

The `verify/` directory holds model-free offline verification scripts, run
via `npm run verify:safety` and `node verify/e2e.mjs`. These are
Windows-specific and drive the bundled daemon over named pipes/TCP.

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
6. **CI must pass.** The CI workflow (`.github/workflows/ci.yml`) runs the
   type-check and unit tests on every push and PR; both must be green. The
   end-to-end verification step runs **best-effort** in CI (`continue-on-error`)
   because `verify/e2e.mjs` needs the bundled runtime, which is gitignored and
   can only be assembled locally via `node scripts/bundle.mjs`. Before merge,
   run `node scripts/bundle.mjs && node verify/e2e.mjs` locally and confirm it
   passes.

Thank you for contributing to Sophos.
