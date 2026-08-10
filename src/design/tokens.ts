// Design tokens — the visual language for the Sophos Windows app.
// "Sophos" — a stark, terminal-minimal port of Prime Intellect's Prime Agent.
// Near-black surfaces, hairline rules, one signature accent (terminal green),
// Geist + Geist Mono type, sharp corners, deliberate motion.
//
// Existing token names are kept stable so feature modules keep compiling;
// the spec-named aliases (surface / surface2 / line / muted / ok / warn / err /
// display) are provided alongside. P7 restyles the whole app onto these.

export const tokens = {
  // ---- Color ----
  color: {
    // Surfaces (near-black ink scale)
    bg: "#0e0e0e",
    surface: "#151515",
    bgElevated: "#151515",
    surface2: "#202020",
    bgRaised: "#202020",
    bgOverlay: "#111",
    line: "#2a2a2a",
    border: "#2a2a2a",
    borderStrong: "#2c2c2c",

    // Text (opacity-based on off-white #f4f4f4)
    text: "#f4f4f4",
    muted: "rgba(244,244,244,0.6)",
    textMuted: "rgba(244,244,244,0.6)",
    textDim: "rgba(244,244,244,0.45)",
    textInverse: "#0e0e0e",

    // Signature accent — terminal green (the ONE place of color)
    accent: "#85ed75",
    accentHover: "#9fff8a",
    accentSoft: "rgba(133,237,117,0.12)",
    accentBorder: "rgba(133,237,117,0.4)",

    // Semantic (functional status, muted & non-blaring)
    ok: "#85ed75",
    success: "#85ed75",
    warn: "#f3bc56",
    warning: "#f3bc56",
    danger: "#ef4444",
    err: "#ef4444",
    dangerSoft: "rgba(239,68,68,0.10)",
    info: "#8b7cf6",

    // Role colors
    user: "#f4f4f4",
    assistant: "rgba(244,244,244,0.9)",
    system: "rgba(244,244,244,0.45)",
    tool: "#38bdf8",
    thinking: "rgba(244,244,244,0.6)",
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
