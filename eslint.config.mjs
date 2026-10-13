// ESLint 9 flat config for Sophos (React frontend in `src/` + Node bridge in
// `bridge/src/`). One gate, one set of rules, no per-directory drift.
//
// Design notes:
//   * `@typescript-eslint/no-explicit-any` is an ERROR — production code must
//     be fully typed. The three legacy `window as any` casts were replaced
//     with a typed global augmentation (see src/vite-env.d.ts).
//   * `react-hooks/exhaustive-deps` is a WARN so a missing dependency is
//     visible without red-ing CI on a rule that is frequently a false
//     positive; the handful of intentional omissions carry an inline reason.
//   * `no-console` is an ERROR for the app + bridge except `console.error`
//     (the one legitimate direct-log path), matching the existing convention
//     that all routine output goes through the engine-log sink or the
//     bridge's stderr logger.
//   * Prettier owns formatting; eslint-config-prettier disables every rule
//     that would fight it, so `lint` and `format` never disagree.

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "bridge/dist/**",
      "src-tauri/target/**",
      "resources/**",
      "public/**",
      "coverage/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    ...react.configs.flat.recommended,
    ...react.configs.flat["jsx-runtime"],
    settings: {
      react: { version: "detect" },
    },
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // React 17+ JSX runtime — no need to import React just for JSX.
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
    },
  },
  {
    files: ["src/**/*.{ts,tsx}", "bridge/src/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      // `console.error` is the one legitimate direct-log path (render crashes
      // in the error boundary, fatal folder-picker failures); everything else
      // must flow through the engine-log sink or the bridge's stderr logger.
      "no-console": ["error", { allow: ["error"] }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
    },
  },
  {
    files: ["src/**/__tests__/**/*.{ts,tsx}", "src/**/*.test.{ts,tsx}"],
    rules: {
      // Tests use console/expect helpers deliberately; keep the gate honest.
      "no-console": "off",
      // Test mocks intentionally reach for `any` to model the loose daemon
      // shapes under test; production code remains strict (`no-explicit-any`
      // is an error everywhere else).
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  prettier,
);
