// Design tokens — the visual language for the Sophos Windows app.
// "Sophos" — a stark, terminal-minimal port of Prime Intellect's Prime Agent.
// Near-black surfaces, hairline rules, one signature accent (terminal green),
// Geist + Geist Mono type, sharp corners, deliberate motion.
//
// Existing token names are kept stable so feature modules keep compiling;
// the spec-named aliases (surface / surface2 / line / muted / ok / warn / err /
// display) are provided alongside. P7 restyles the whole app onto these.
//
// THEME: the color values below are CSS custom-property references (var(--pa-*))
// resolved at the DOM level, so the whole palette switches with the theme. The
// actual values live in src/design/global.css — `:root` carries the dark
// defaults and `:root[data-theme="light"]` overrides them. The JS token names
// stay stable; only the values are indirection. Non-color tokens (font, space,
// radius, motion, shadow, layout) are theme-independent and stay literal.

export const tokens = {
  // ---- Color ----
  color: {
    // Surfaces (near-black ink scale)
    bg: "var(--pa-ink)",
    surface: "var(--pa-card)",
    bgElevated: "var(--pa-card)",
    surface2: "var(--pa-secondary)",
    bgRaised: "var(--pa-secondary)",
    bgOverlay: "var(--pa-overlay)",
    line: "var(--pa-border)",
    border: "var(--pa-border)",
    borderStrong: "var(--pa-border-strong)",

    // Text (opacity-based on the paper color)
    text: "var(--pa-paper)",
    muted: "var(--pa-paper-muted)",
    textMuted: "var(--pa-paper-muted)",
    textDim: "var(--pa-paper-dim)",
    // Primary button text — the button is always solid white bg + black text,
    // so this stays literal in both themes.
    textInverse: "#0e0e0e",

    // Signature accent — terminal green (the ONE place of color)
    accent: "var(--pa-green)",
    accentHover: "var(--pa-green-hover)",
    accentSoft: "var(--pa-green-soft)",
    accentBorder: "var(--pa-green-border)",

    // Semantic (functional status, muted & non-blaring)
    ok: "var(--pa-green)",
    success: "var(--pa-green)",
    warn: "var(--pa-amber)",
    warning: "var(--pa-amber)",
    danger: "var(--pa-danger)",
    err: "var(--pa-danger)",
    dangerSoft: "var(--pa-danger-soft)",
    info: "var(--pa-info)",

    // Role colors
    user: "var(--pa-paper)",
    assistant: "var(--pa-paper-strong)",
    system: "var(--pa-paper-dim)",
    tool: "var(--pa-tool)",
    thinking: "var(--pa-paper-muted)",
  },

  // ---- Typography ----
  font: {
    display: "'Geist', 'Geist Fallback', ui-sans-serif, system-ui, sans-serif",
    sans: "'Geist', 'Geist Fallback', ui-sans-serif, system-ui, sans-serif",
    mono: "'Geist Mono', 'Geist Mono Fallback', ui-monospace, monospace",
    size: {
      xs: "11px",
      sm: "12.5px",
      md: "14px",
      lg: "16px",
      xl: "19px",
      "2xl": "24px",
      "3xl": "31px",
    },
    weight: {
      regular: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
    },
    leading: {
      tight: 1.15,
      normal: 1.5,
      relaxed: 1.65,
    },
  },

  // ---- Spacing (tight, instrument-like) ----
  space: {
    xs: "4px",
    sm: "8px",
    md: "12px",
    lg: "16px",
    xl: "22px",
    "2xl": "30px",
    "3xl": "40px",
  },

  // ---- Radius (sharp, machined — hairlines, no rounding) ----
  radius: {
    sm: "0px",
    md: "0px",
    lg: "0px",
    xl: "0px",
    full: "9999px",
  },

  // ---- Motion (deliberate, orchestrated) ----
  motion: {
    fast: "100ms",
    base: "180ms",
    slow: "300ms",
    ease: "cubic-bezier(0.3, 0, 0.2, 1)",
    easeOut: "cubic-bezier(0.16, 1, 0.3, 1)",
  },

  // ---- Shadows (borders read through lines, not glow; green ring accent) ----
  shadow: {
    sm: "none",
    md: "none",
    lg: "none",
    glow: "0 0 0 1px rgba(133,237,117,0.28)",
  },

  // ---- Layout ----
  layout: {
    sidebarW: "232px",
    headerH: "48px",
    inputH: "auto",
    maxContentW: "920px",
  },
} as const;

export type DesignTokens = typeof tokens;
