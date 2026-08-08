// Navigation model for the Sophos shell.

import { createElement, type ReactNode } from "react";
import { ChatIcon, SessionsIcon, AgentsIcon, SettingsIcon } from "./icons";

function InboxIcon({ size = 16, color = "currentColor" }: { size?: number; color?: string }) {
  return createElement("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: color, strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" },
    createElement("path", { d: "M4 5h16v14H4z" }), createElement("path", { d: "m4 7 8 6 8-6" }),
    createElement("path", { d: "M17 4v4" }), createElement("circle", { cx: 17, cy: 4, r: 2, fill: color, stroke: "none" }));
}

export type View = "chat" | "sessions" | "agents" | "inbox" | "settings";

export interface NavItem {
  id: View;
  label: string;
  icon: (p: { size?: number; color?: string }) => ReactNode;
  hint: string;
}

export const NAV_ITEMS: NavItem[] = [
  { id: "chat", label: "Chat", icon: ChatIcon, hint: "Conversation with the agent" },
  { id: "sessions", label: "Sessions", icon: SessionsIcon, hint: "Saved and active sessions" },
  { id: "agents", label: "Agents", icon: AgentsIcon, hint: "Attached agents" },
  { id: "inbox", label: "Inbox", icon: InboxIcon, hint: "Agent relay messages" },
  { id: "settings", label: "Settings", icon: SettingsIcon, hint: "Providers, models, preferences" },
];
