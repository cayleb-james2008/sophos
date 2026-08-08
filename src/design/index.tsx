// Design system — the Sophos command-center visual language.
// Barrel: re-exports all primitives, surfaces, overlays, and motion helpers.
// P4/P5 consume this surface; keep the exports stable.

export { tokens } from "./tokens";
export type { DesignTokens } from "./tokens";

export * from "./core";
export * from "./overlay";
export * from "./motion";
