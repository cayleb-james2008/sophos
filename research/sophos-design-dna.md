# Sophos Redesign — Design DNA & Worker Brief (shared reference)

**Source:** live scrape of https://www.primeintellect.ai/ on 2026-08-08 via
agent-browser (DOM computed styles on all visible elements + Tailwind `:root`
CSS custom properties + screenshots at 7 scroll positions).
**Screenshots:** `prime-agent-windows/research/pi-website-ref/pi-full-page.png` + `pi-scroll-{0,900,1800,2700,3600,4500,5400}.png`
**CSS vars (live):** extracted from `:root` on the live site.

## 1. Colors (exact)

Tailwind/shadcn `:root` vars, scraped live:

| Token | Hex | Use |
|---|---|---|
| `--background` | `#0e0e0e` | App background (near-black, neutral) |
| `--foreground` | `#f4f4f4` | Primary text (off-white) |
| `--card` | `#151515` | Card surfaces |
| `--popover` | `#111` | Popovers |
| `--secondary` | `#202020` | Secondary surfaces |
| `--muted` | `#1b1b1b` | Muted surfaces |
| `--accent` | `#2c2c2c` | Accent surfaces |
| `--border` | `#2a2a2a` | ALL borders / dividers (hairline) |
| `--input` | `#2a2a2a` | Input borders |
| `--ring` | `#ffffffa3` | Focus ring |
| `--destructive` | `#ef4444` | Error/destructive |
| `--chart-1` | `#85ed75` | Terminal green (the "$" prompt color) — SOLE accent |
| `--chart-2` | `#f3bc56` | Amber (secondary semantic) |
| `--chart-3` | `#8b7cf6` | Purple |
| `--chart-4` | `#38bdf8` | Cyan |
| `--chart-5` | `#fb7185` | Rose |

**Text hierarchy is opacity-based on `#f4f4f4`**, not gray shades:
- 0.9 opacity → headings/strong
- 0.6–0.62 → body text
- 0.45–0.54 → secondary/caption
- 0.3 → faint labels / disabled
- 0.16 → borders on transparent buttons

## 2. Typography

- Display/headings: **Geist** (Vercel's font family; stack on the site: `"ABC Favorit", Geist, "Geist Fallback", sans-serif`)
- Mono/terminal/code: **Geist Mono** (stack: `"ABC Favorit Mono", monospace` → `"Geist Mono"`)
- Body: Geist / system-ui
- Load via the `geist` npm package (Vercel's official font package) — `geist/font/sans` and `geist/font/mono`. In a Vite (non-Next) app, import the CSS or use the `@fontsource/geist-sans` and `@fontsource/geist-mono` packages, OR load from Google Fonts / a self-hosted woff2. Pick whichever is simplest for Vite — `@fontsource/geist-sans` + `@fontsource/geist-mono` are the most reliable for a Vite/React app.

## 3. Geometry & motion

- `--radius: 0px` — **sharp corners everywhere**, no rounding. No `border-radius` on any element. The ONLY exception is perfectly circular status dots (8px diameter, `border-radius: 50%`) which are dots, not rounded rectangles.
- Borders (`#2a2a2a` hairlines) are the primary visual divider, not shadows
- Subtle card gradient: `linear-gradient(180deg, #111 0%, #0e0e0e 100%)`
- Fixed nav: `rgba(14,14,14,0.78)` + `backdrop-blur-md` (`backdrop-filter: blur(12px)`)
- Terminal code blocks: dark bg, **green `$` prompt** (`#85ed75`)
- **Primary button**: solid **white bg** (`#fff`) + **black text** (`#000`), sharp corners, no radius
- **Secondary button**: transparent + `rgba(255,255,255,0.1)` bg + `rgba(255,255,255,0.16)` border
- No copper, no glow, no "flight-deck" — stark, minimal, terminal-grade
- Motion: snappy, terminal-flavored. Keys: `pa-fade-in` (opacity), `pa-slide-up` (8px → 0), `pa-scale-in` (0.98 → 1). Durations stay tight (100–180ms). No "orchestrated" 300ms+ sweeps.

## 4. Aesthetic summary

Stark near-black. Sharp corners. Hairline `#2a2a2a` borders. Off-white `#f4f4f4` text with opacity hierarchy. Geist + Geist Mono typography. Terminal green `#85ed75` as the sole color accent (status, prompts, live indicators). Monospace command blocks. Minimal, technical, confident. **"Open superintelligence stack" terminal minimal** — not "flight-deck instrument."

## 5. The rebrand — SOPHOS

The app is being rebranded from "Prime Agent" to **Sophos** (Greek: wisdom/intellect).

- Repo: `github.com/cayleb-james2008/sophos` (NEW repo; old `prime-agent-windows` scrapped)
- Package name: `sophos`
- Tauri productName: `Sophos`
- Identifier: `com.sophos.app` (or `com.cayleb.sophos`)
- Window title: `Sophos`
- Brand wordmark in the SystemBar: `SOPHOS` in Geist, with `// Windows` subtitle
- Description: "Sophos — a Windows-native port of Prime Intellect's Prime Agent. Credits: PrimeIntellect-ai/prime-agent (upstream)."
- Git author: `Cayleb` ( NEVER HALFTONE)
- **Fresh icon**: a simple geometric SVG mark, thematically related to "Sophos" (wisdom/intellect). Distinct from the Prime Intellect logo. Colors: off-white `#f4f4f4` + terminal green `#85ed75`, sharp corners, minimal. Works at 16px and 512px. Idea: a sharp geometric "Σ" (sigma, sum of knowledge) or a stylized open-eye/diamond shape — but keep it simple, 2-3 colors, flat SVG.

## 6. Seamless installer requirement

The user downloads ONLY the installer `.exe`. The installer bundles:
- Portable Node runtime (`resources/node/`)
- Daemon `dist/` (`resources/daemon/dist/`)
- Bridge `dist/` (`resources/bridge/dist/`)
- Shared `node_modules/` (`resources/node_modules/`)
- The Tauri native binary + frontend

`npm run tauri build` produces the NSIS installer. The README documents:
download → run `.exe` → app installs to `~\AppData\Local\Sophos` → launch → first-run provider setup.

(Note: there's a known `MAX_PATH` blocker for the `@mistralai` deep node_modules path during `makensis`. The workaround is documented in the existing README — strip `.d.ts`/`.map` files or enable long-paths. The build worker should apply the workaround or document it clearly.)

## 7. Token mapping (P1 spec — exact values)

The `tokens.ts` token NAMES stay stable (so feature modules compile). Only VALUES change:

```ts
color: {
  bg:         "#0e0e0e",     // was #0A0B0D
  surface:    "#151515",     // was #12141A (--card)
  bgElevated: "#151515",
  surface2:   "#202020",     // was #181B22 (--secondary)
  bgRaised:   "#202020",
  bgOverlay:  "#111",        // was #1C1F26 (--popover)
  line:       "#2a2a2a",     // was #23262E (--border)
  border:     "#2a2a2a",
  borderStrong: "#2c2c2c",   // was #2E323C (--accent)

  text:       "#f4f4f4",     // was #E8E9EC (--foreground)
  muted:      "rgba(244,244,244,0.6)",   // was #8A8F98 — opacity-based now
  textMuted:  "rgba(244,244,244,0.6)",
  textDim:    "rgba(244,244,244,0.45)",  // was #6E7380
  textInverse: "#0e0e0e",

  accent:        "#85ed75",  // was #C98A5B (copper) → terminal green
  accentHover:   "#9fff8a",  // lighter green hover
  accentSoft:    "rgba(133,237,117,0.12)",
  accentBorder:  "rgba(133,237,117,0.4)",

  ok:      "#85ed75",  // success = terminal green
  success: "#85ed75",
  warn:    "#f3bc56",  // amber (--chart-2)
  warning: "#f3bc56",
  danger:  "#ef4444",  // (--destructive)
  err:     "#ef4444",
  info:    "#8b7cf6",  // purple (--chart-3)

  user:      "#f4f4f4",
  assistant: "rgba(244,244,244,0.9)",
  system:    "rgba(244,244,244,0.45)",
  tool:      "#38bdf8",      // cyan (--chart-4)
  thinking:  "rgba(244,244,244,0.6)",
},

font: {
  display: "'Geist', 'Geist Fallback', ui-sans-serif, system-ui, sans-serif",
  sans:    "'Geist', 'Geist Fallback', ui-sans-serif, system-ui, sans-serif",
  mono:    "'Geist Mono', 'Geist Mono Fallback', ui-monospace, monospace",
  // sizes/weights/leading stay the same
},

radius: {
  sm:   "0px",   // was 3px
  md:   "0px",   // was 5px
  lg:   "0px",   // was 8px
  xl:   "0px",   // was 12px
  full: "9999px", // KEEP — needed for circular status dots only
},

// motion stays the same (already snappy)
// shadow: reduce/remove glow; use borders instead
shadow: {
  sm: "none",
  md: "none",
  lg: "none",
  glow: "0 0 0 1px rgba(133,237,117,0.28)",  // green ring instead of copper glow
},
```

## 8. What to remove (the "Prime Precision" hangover)

Search-and-replace targets (every piece):
- All references to `Space Grotesk`, `Inter` (as a font, not the token name), `JetBrains Mono` in CSS/TS/HTML
- The copper accent `#C98A5B`, `#D6A077`, `rgba(201,138,91,...)` anywhere
- Any `borderRadius` that isn't `0` or `9999px` (circular dots)
- The "copper hairline grid + radial copper wash" background in `Shell.tsx`
- The "flight-deck" / "command rail" / "instrument" language in comments (optional but tone-setting)
- The "PRIME" wordmark → "SOPHOS"
- The `BoltGlyph` → the new Sophos geometric icon
