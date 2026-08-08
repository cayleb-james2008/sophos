// Feature-local icon set for the Agents module. Self-contained 16px line
// icons so the agents feature never depends on shell or other feature sets.

import React from "react";
import type { SVGProps } from "react";

type IconProps = {
  size?: number;
  color?: string;
  strokeWidth?: number;
  style?: React.CSSProperties;
};

function base({ size = 16, color = "currentColor", strokeWidth = 1.5, style }: IconProps): SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: color,
    strokeWidth,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    style,
  };
}

export function UserIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M17 21v-2a4 4 0 0 0-3-3.87M9 21v-2a4 4 0 0 1 3-3.87M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />
    </svg>
  );
}

export function BotIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="4" y="6" width="16" height="12" rx="2" />
      <path d="M9 2h6v2H9zM12 17v3M9 17h6" />
    </svg>
  );
}

// Plug into a socket — used for attach.
export function AttachIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M9 2v6H5l4 4V4a4 4 0 0 1 8 0v8a4 4 0 0 1-8 0H9v-2" />
      <path d="M15 17h6a2 2 0 0 1 2 2v1" />
      <path d="M9 11.5a4 4 0 0 0 0 8 4 4 0 0 0 8 0 4 4 0 0 0 0-8" />
    </svg>
  );
}

// Eject / unplug — used for detach.
export function DetachIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="7" x2="12" y2="12" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
      <path d="M12 2v4M12 18v4" />
    </svg>
  );
}

export function PulseIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M3 12h4l2-6 4 12 2-6h7" />
    </svg>
  );
}

export function RefreshIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

export function MessageIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <path d="M8 9h8M8 13h5" />
    </svg>
  );
}

export function InboxIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M4 6h16v14H4z" />
      <path d="m4 7 8 6 8-6" />
      <path d="M17 4v4M7 4v4" />
    </svg>
  );
}

export function LayersIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M12 2 2 7l10 5 10-5-10-5z" />
      <path d="M2 12l10 5 10-5" />
      <path d="M2 17l10 5 10-5" />
    </svg>
  );
}

export function PlugIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M9 2h6v6H9zM4 6h16M8 8v8a4 4 0 0 0 8 0V8M2 5.5h20" />
    </svg>
  );
}

export function ClockIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

export function CheckIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
