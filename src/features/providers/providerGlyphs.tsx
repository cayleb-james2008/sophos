// providerGlyphs — small SVG glyphs for each known provider, used in the
// model selector so providers are visually distinct at a glance. Falls back
// to a generic "chip" glyph for unknown providers.

export function ProviderGlyph({ provider, size = 14, color = "currentColor" }: { provider: string; size?: number; color?: string }) {
  const p = provider.toLowerCase();
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: color,
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (p.includes("ollama")) {
    // llama head
    return (
      <svg {...common}>
        <path d="M12 3c-3 0-5 2-5 5v3c0 2.5 1.5 4 3.5 4.5L9 21h6l-1.5-5.5C16.5 15 18 13.5 18 11V8c0-3-2-5-6-5z" />
        <circle cx="9.5" cy="9" r="1" fill={color} stroke="none" />
        <circle cx="14.5" cy="9" r="1" fill={color} stroke="none" />
      </svg>
    );
  }
  if (p.includes("openrouter")) {
    // branching router
    return (
      <svg {...common}>
        <circle cx="5" cy="6" r="2" />
        <circle cx="5" cy="18" r="2" />
        <circle cx="19" cy="12" r="2" />
        <path d="M7 6h6a4 4 0 0 1 4 4v0" />
        <path d="M7 18h6a4 4 0 0 0 4-4v0" />
      </svg>
    );
  }
  if (p.includes("minimax")) {
    // minimax — opposing chevrons
    return (
      <svg {...common}>
        <path d="M4 6l6 6-6 6" />
        <path d="M14 6l6 6-6 6" />
      </svg>
    );
  }
  if (p.includes("codex") || p.includes("opencode")) {
    // code brackets
    return (
      <svg {...common}>
        <path d="M8 6l-5 6 5 6" />
        <path d="M16 6l5 6-5 6" />
      </svg>
    );
  }
  if (p.includes("openai")) {
    // hexagon
    return (
      <svg {...common}>
        <path d="M12 3l7 4v10l-7 4-7-4V7z" />
      </svg>
    );
  }
  if (p.includes("anthropic") || p.includes("claude")) {
    // starburst
    return (
      <svg {...common}>
        <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
      </svg>
    );
  }
  // generic chip
  return (
    <svg {...common}>
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
