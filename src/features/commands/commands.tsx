// Command palette model — the catalog of commands surfaced by the ⌘K palette.
// Slash commands (refine / compact / retry / goal / autonomous / heartbeat / schedule / skills) run
// through the IPC client's runCommand(); navigation and session commands run
// local callbacks.

import type { ReactNode } from "react";
import type { IpcClient } from "../../ipc/client";
import type { View } from "../../shell/nav";
import {
  CommandIcon,
  PlayIcon,
  CpuIcon,
  SparkIcon,
  TargetIcon,
  ZapIcon,
  HeartbeatIcon,
  CalendarIcon,
  ChatIcon,
  LayersIcon,
  RefreshIcon,
  BookIcon,
  ForkIcon,
  GaugeIcon,
  ClockIcon,
  KeyIcon,
} from "../sessions/icons";

function ExportIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function ShareIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.6" y1="13.5" x2="15.4" y2="17.5" />
      <line x1="15.4" y1="6.5" x2="8.6" y2="10.5" />
    </svg>
  );
}

function CopyIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function TreeIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="5" r="2" />
      <circle cx="18" cy="6" r="2" />
      <circle cx="12" cy="19" r="2" />
      <path d="M6 7v3a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-.5" />
      <path d="M12 12v5" />
      <path d="M18 8v1a3 3 0 0 1-3 3h-3" />
    </svg>
  );
}

function TextIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 6 4 4 20 4 20 6" />
      <line x1="12" y1="4" x2="12" y2="20" />
      <line x1="8" y1="20" x2="16" y2="20" />
    </svg>
  );
}

function QuestionIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.2 9a2.8 2.8 0 0 1 5.4 1c0 1.7-2.6 2.4-2.6 3.7" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function SearchIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

export interface PaletteCommand {
  id: string;
  group: string;
  label: string;
  description: string;
  keywords?: string;
  icon?: ReactNode;
  hint?: string;
  /** Keep the palette open after running (for sub-mode commands like /name, Find session…). */
  keepOpen?: boolean;
  run: () => void;
}

export interface PaletteGroup {
  id: string;
  label: string;
  commands: PaletteCommand[];
}

export function buildPaletteCommands(
  ipc: IpcClient,
  onNavigate: (view: View) => void,
  onNewSession: () => void,
  onNameRequest: () => void,
  onFindSessionRequest: () => void,
  onSearchTranscriptRequest: () => void,
): PaletteGroup[] {
  return [
    {
      id: "session",
      label: "Session",
      commands: [
        {
          id: "find-session",
          group: "Session",
          label: "Find session…",
          description: "Search sessions by name and open the manager filtered",
          keywords: "find search session title name locate",
          icon: <SearchIcon />,
          keepOpen: true,
          run: onFindSessionRequest,
        },
        {
          id: "search-transcript",
          group: "Session",
          label: "Search transcript…",
          description: "Search the current session's messages and jump to a match",
          keywords: "search transcript messages find content text",
          icon: <SearchIcon />,
          keepOpen: true,
          run: onSearchTranscriptRequest,
        },
        {
          id: "new-session",
          group: "Session",
          label: "New session",
          description: "Start a fresh agent session",
          keywords: "create start new begin",
          icon: <PlayIcon size={15} />,
          run: onNewSession,
        },
        {
          id: "go-sessions",
          group: "Session",
          label: "Open session manager",
          description: "Resume, fork, and manage sessions",
          keywords: "sessions list resume fork switch",
          icon: <LayersIcon size={15} />,
          run: () => onNavigate("sessions"),
        },
        {
          id: "name",
          group: "Session",
          label: "/name",
          description: "Set the session display name (e.g. /name My task)",
          keywords: "name rename title session",
          icon: <TextIcon />,
          keepOpen: true,
          run: onNameRequest,
        },
        {
          id: "tree",
          group: "Session",
          label: "/tree",
          description: "Load the session tree and continue from any point",
          keywords: "tree branch session history navigate",
          icon: <TreeIcon />,
          run: () => {
            void ipc.getSessionTree().catch(() => {});
          },
        },
        {
          id: "clone",
          group: "Session",
          label: "/clone",
          description: "Duplicate the current active branch into a new session",
          keywords: "clone duplicate copy branch",
          icon: <LayersIcon size={15} />,
          run: () => {
            void ipc.cloneSession().catch(() => {});
          },
        },
        {
          id: "fork",
          group: "Session",
          label: "/fork",
          description: "Fork a new session from an earlier message",
          keywords: "fork branch split new",
          icon: <ForkIcon size={15} />,
          run: () => {
            void ipc.runCommand("fork").catch(() => {});
          },
        },
      ],
    },
    {
      id: "model",
      label: "Model & Providers",
      commands: [
        {
          id: "go-settings",
          group: "Model & Providers",
          label: "Providers & models",
          description: "Manage providers, models, and connection",
          keywords: "providers models settings login logout api key",
          icon: <CpuIcon size={15} />,
          run: () => onNavigate("settings"),
        },
      ],
    },
    {
      id: "advanced",
      label: "Advanced",
      commands: [
        {
          id: "refine",
          group: "Advanced",
          label: "/refine",
          description: "Refine the current session's goal and plan",
          keywords: "refine plan goal improve",
          icon: <SparkIcon size={15} />,
          run: () => {
            void ipc.refine();
          },
        },
        {
          id: "compact",
          group: "Advanced",
          label: "/compact",
          description: "Compact the current session's context",
          keywords: "compact context summarize compress",
          icon: <ZapIcon size={15} />,
          run: () => {
            void ipc.compact();
          },
        },
        {
          id: "retry",
          group: "Advanced",
          label: "/retry",
          description: "Retry the last failed operation",
          keywords: "retry redo again repeat",
          icon: <RefreshIcon size={15} />,
          run: () => {
            void ipc.retry();
          },
        },
        {
          id: "goal",
          group: "Advanced",
          label: "/goal",
          description: "Set or update the session goal",
          keywords: "goal objective target",
          icon: <TargetIcon size={15} />,
          run: () => {
            void ipc.prompt("/goal");
          },
        },
        {
          id: "autonomous",
          group: "Advanced",
          label: "/autonomous",
          description: "Toggle autonomous execution mode",
          keywords: "auto autonomous mode",
          icon: <ZapIcon size={15} />,
          run: () => {
            void ipc.prompt("/autonomous");
          },
        },
        {
          id: "heartbeat",
          group: "Advanced",
          label: "/heartbeat",
          description: "Check the agent's heartbeat and liveness",
          keywords: "heartbeat status alive ping",
          icon: <HeartbeatIcon size={15} />,
          run: () => {
            void ipc.prompt("/heartbeat");
          },
        },
        {
          id: "schedule",
          group: "Advanced",
          label: "/schedule",
          description: "View or schedule recurring tasks",
          keywords: "schedule cron task timer",
          icon: <CalendarIcon size={15} />,
          run: () => {
            void ipc.prompt("/schedule");
          },
        },
        {
          id: "skills",
          group: "Advanced",
          label: "/skills",
          description: "List and manage available skills",
          keywords: "skills list capabilities",
          icon: <BookIcon size={15} />,
          run: () => {
            void ipc.prompt("/skills");
          },
        },
        {
          id: "skill-create",
          group: "Advanced",
          label: "/skill:create",
          description: "Create a new skill from a template",
          keywords: "skill create new template",
          icon: <SparkIcon size={15} />,
          run: () => {
            void ipc.prompt("/skill:create");
          },
        },
      ],
    },
    {
      id: "share-export",
      label: "Share & Export",
      commands: [
        {
          id: "export",
          group: "Share & Export",
          label: "/export",
          description: "Export the current session to HTML or JSONL",
          keywords: "export html jsonl save share",
          icon: <ExportIcon />,
          run: () => {
            // ChatView owns the format picker + save dialog + IPC + toast.
            window.dispatchEvent(new CustomEvent("sophos:request-export"));
          },
        },
        {
          id: "share",
          group: "Share & Export",
          label: "/share",
          description: "Share the session as a private GitHub gist",
          keywords: "share gist link publish",
          icon: <ShareIcon />,
          run: () => {
            // ChatView owns the runCommand('share') call + honest toast.
            window.dispatchEvent(new CustomEvent("sophos:request-share"));
          },
        },
        {
          id: "copy",
          group: "Share & Export",
          label: "/copy",
          description: "Copy the last assistant message to the clipboard",
          keywords: "copy clipboard last assistant",
          icon: <CopyIcon />,
          run: () => {
            void ipc.runCommand("copy");
          },
        },
      ],
    },
    {
      id: "side",
      label: "Side questions",
      commands: [
        {
          id: "btw",
          group: "Side questions",
          label: "/btw",
          description: "Ask an inline side question without touching the session",
          keywords: "btw side question aside parallel",
          icon: <QuestionIcon />,
          run: () => {
            void ipc.runCommand("btw");
          },
        },
        {
          id: "side",
          group: "Side questions",
          label: "/side",
          description: "Ask an inline side question (alias of /btw)",
          keywords: "side btw question aside",
          icon: <QuestionIcon />,
          run: () => {
            void ipc.runCommand("side");
          },
        },
      ],
    },
    {
      id: "usage",
      label: "Usage & Info",
      commands: [
        {
          id: "usage",
          group: "Usage & Info",
          label: "/usage",
          description: "Show token, cost, and context breakdown",
          keywords: "usage tokens cost context breakdown",
          icon: <GaugeIcon size={15} />,
          run: () => {
            void ipc.runCommand("usage");
          },
        },
        {
          id: "context",
          group: "Usage & Info",
          label: "/context",
          description: "Show context window and message stats",
          keywords: "context stats window messages tokens",
          icon: <GaugeIcon size={15} />,
          run: () => {
            void ipc.runCommand("context");
          },
        },
        {
          id: "hotkeys",
          group: "Usage & Info",
          label: "/hotkeys",
          description: "Show all keyboard shortcuts",
          keywords: "hotkeys shortcuts keys keybindings",
          icon: <KeyIcon size={15} />,
          run: () => {
            void ipc.runCommand("hotkeys");
          },
        },
        {
          id: "changelog",
          group: "Usage & Info",
          label: "/changelog",
          description: "Display version history",
          keywords: "changelog version history releases",
          icon: <ClockIcon size={15} />,
          run: () => {
            void ipc.runCommand("changelog");
          },
        },
      ],
    },
    {
      id: "navigate",
      label: "Navigate",
      commands: [
        {
          id: "nav-chat",
          group: "Navigate",
          label: "Go to Chat",
          description: "Open the conversation view",
          keywords: "chat conversation talk",
          icon: <ChatIcon size={15} />,
          run: () => onNavigate("chat"),
        },
        {
          id: "nav-agents",
          group: "Navigate",
          label: "Go to Agents",
          description: "Open the agents view",
          keywords: "agents attach subagents",
          icon: <CommandIcon size={15} />,
          run: () => onNavigate("agents"),
        },
        {
          id: "nav-settings",
          group: "Navigate",
          label: "Go to Settings",
          description: "Open the settings view",
          keywords: "settings preferences config",
          icon: <CpuIcon size={15} />,
          run: () => onNavigate("settings"),
        },
      ],
    },
  ];
}
