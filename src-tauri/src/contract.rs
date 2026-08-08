//! IPC contract — the Rust mirror of `src/ipc/contract.ts`.
//!
//! This is the single source of truth for the JSON-RPC contract between the
//! React frontend, the Rust Tauri bridge, and the Node bridge sidecar. It must
//! stay byte-for-byte compatible with the TypeScript types in
//! `src/ipc/contract.ts`. Do not drift.
//!
//! The Rust shell is a transparent relay: it deserializes an `IpcCommand` from
//! the frontend, forwards it verbatim to the sidecar over stdio, and forwards
//! `IpcEvent`s from the sidecar back to the frontend as Tauri events.

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Commands (frontend -> sidecar, via Rust)
// ---------------------------------------------------------------------------

/// A single JSON-RPC command. Tagged by `method`, with `params` as the content.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "method", content = "params")]
pub enum IpcCommand {
    #[serde(rename = "prompt")]
    Prompt {
        text: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        options: Option<PromptOptions>,
    },
    #[serde(rename = "abort")]
    Abort {},
    #[serde(rename = "steer")]
    Steer { text: String },
    #[serde(rename = "setModel")]
    SetModel {
        provider: String,
        model: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        thinking: Option<String>,
        #[serde(rename = "serviceTier", skip_serializing_if = "Option::is_none")]
        service_tier: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        transport: Option<String>,
    },
    #[serde(rename = "newSession")]
    NewSession {
        #[serde(skip_serializing_if = "Option::is_none")]
        cwd: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        goal: Option<String>,
    },
    #[serde(rename = "switchSession")]
    SwitchSession { id: String },
    #[serde(rename = "resumeSession")]
    ResumeSession { path_or_id: String },
    #[serde(rename = "forkSession")]
    ForkSession { path_or_id: String },
    #[serde(rename = "listSessions")]
    ListSessions {},
    #[serde(rename = "listAgents")]
    ListAgents {},
    #[serde(rename = "attachAgent")]
    AttachAgent { id: String },
    #[serde(rename = "getState")]
    GetState {},
    #[serde(rename = "getTranscript")]
    GetTranscript {},
    #[serde(rename = "getModels")]
    GetModels {},
    #[serde(rename = "getProviders")]
    GetProviders {},
    #[serde(rename = "login")]
    Login {
        provider: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        api_key: Option<String>,
    },
    #[serde(rename = "logout")]
    Logout { provider: String },
    #[serde(rename = "getSettings")]
    GetSettings {},
    #[serde(rename = "setSettings")]
    SetSettings { settings: serde_json::Value },
    #[serde(rename = "runCommand")]
    RunCommand {
        command: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        args: Option<Vec<String>>,
    },
    #[serde(rename = "getContextStats")]
    GetContextStats {},
    #[serde(rename = "getRlmChildren")]
    GetRlmChildren {},
    #[serde(rename = "sendAgentMessage")]
    SendAgentMessage { agent_id: String, message: String },
    #[serde(rename = "listInbox")]
    ListInbox {},
    #[serde(rename = "markMessageRead")]
    MarkMessageRead { message_id: String },
    #[serde(rename = "compact")]
    Compact {},
    #[serde(rename = "retry")]
    Retry {},
    #[serde(rename = "refine")]
    Refine {},
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thinking: Option<String>,
    #[serde(rename = "serviceTier", skip_serializing_if = "Option::is_none")]
    pub service_tier: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transport: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub goal: Option<String>,
}

// ---------------------------------------------------------------------------
// Events (sidecar -> frontend, via Rust)
// ---------------------------------------------------------------------------

/// A single event emitted to the frontend. Tagged by `type`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum IpcEvent {
    #[serde(rename = "session_event")]
    SessionEvent { event: serde_json::Value },
    #[serde(rename = "snapshot")]
    Snapshot { state: ConnectionState },
    #[serde(rename = "resynced")]
    Resynced { state: ConnectionState },
    #[serde(rename = "connection_status")]
    ConnectionStatus { status: ConnectionStatus },
    #[serde(rename = "extension_ui_request")]
    ExtensionUiRequest { request: serde_json::Value },
    #[serde(rename = "agent_message")]
    AgentMessage { message: AgentMessage },
    #[serde(rename = "agent_list")]
    AgentList { agents: Vec<AgentInfo> },
    #[serde(rename = "agent_status")]
    AgentStatus { agent: AgentInfo },
    #[serde(rename = "refinement_result")]
    RefinementResult { result: serde_json::Value },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum ConnectionStatus {
    #[serde(rename = "connecting")]
    Connecting,
    #[serde(rename = "connected")]
    Connected,
    #[serde(rename = "disconnected")]
    Disconnected {
        #[serde(skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
    },
    #[serde(rename = "reconnecting")]
    Reconnecting,
}

// ---------------------------------------------------------------------------
// Data shapes
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionState {
    #[serde(rename = "activeSessionId", default, skip_serializing_if = "Option::is_none")]
    pub active_session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<ModelRef>,
    pub status: ConnectionStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub queue: Option<QueueState>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub goals: Option<Vec<Goal>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context: Option<ContextStats>,
    #[serde(rename = "rlmChildren", default, skip_serializing_if = "Option::is_none")]
    pub rlm_children: Option<Vec<RlmChild>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelRef {
    pub provider: String,
    pub model: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thinking: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueState {
    pub mode: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pending: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Goal {
    pub id: String,
    pub objective: String,
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub progress: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextStats {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tokens: Option<u64>,
    #[serde(rename = "contextWindow", default, skip_serializing_if = "Option::is_none")]
    pub context_window: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub messages: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub compaction: Option<CompactionInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompactionInfo {
    #[serde(rename = "lastCompactedAt", default, skip_serializing_if = "Option::is_none")]
    pub last_compacted_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RlmChild {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub status: String,
    #[serde(rename = "parentId", default, skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentMessage {
    pub id: String,
    #[serde(rename = "fromAgentId")]
    pub from_agent_id: String,
    #[serde(rename = "fromAgentName", default, skip_serializing_if = "Option::is_none")]
    pub from_agent_name: Option<String>,
    #[serde(rename = "toAgentId")]
    pub to_agent_id: String,
    #[serde(rename = "toAgentName", default, skip_serializing_if = "Option::is_none")]
    pub to_agent_name: Option<String>,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub read: Option<bool>,
    #[serde(rename = "threadId", default, skip_serializing_if = "Option::is_none")]
    pub thread_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentInfo {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub status: String,
    #[serde(rename = "sessionId", default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
}

// ---------------------------------------------------------------------------
// Native perf module shapes (Rust-only, not part of the wire contract)
// ---------------------------------------------------------------------------

/// A parsed transcript message (JSONL line).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptMessage {
    pub id: String,
    pub role: String,
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thinking: Option<String>,
    #[serde(rename = "toolCalls", default, skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCall>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
}

/// A saved session discovered by a native session scan.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(rename = "createdAt", default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(rename = "updatedAt", default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
}

/// Result of a native token estimate.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenEstimate {
    pub tokens: u64,
    pub chars: usize,
    pub words: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_serializes_to_method_params_shape() {
        let cmd = IpcCommand::Prompt {
            text: "hi".to_string(),
            options: None,
        };
        let json = serde_json::to_string(&cmd).unwrap();
        assert_eq!(json, r#"{"method":"prompt","params":{"text":"hi"}}"#);
    }

    #[test]
    fn command_deserializes_from_frontend_shape() {
        let json = r#"{"method":"setModel","params":{"provider":"p","model":"m"}}"#;
        let cmd: IpcCommand = serde_json::from_str(json).unwrap();
        match cmd {
            IpcCommand::SetModel { provider, model, .. } => {
                assert_eq!(provider, "p");
                assert_eq!(model, "m");
            }
            other => panic!("unexpected variant: {other:?}"),
        }
    }

    #[test]
    fn event_deserializes_from_sidecar_shape() {
        let json = r#"{"type":"connection_status","status":{"kind":"connected"}}"#;
        let ev: IpcEvent = serde_json::from_str(json).unwrap();
        match ev {
            IpcEvent::ConnectionStatus { status } => {
                assert!(matches!(status, ConnectionStatus::Connected));
            }
            other => panic!("unexpected variant: {other:?}"),
        }
    }

    #[test]
    fn event_serializes_with_type_tag() {
        let ev = IpcEvent::ConnectionStatus {
            status: ConnectionStatus::Disconnected {
                reason: Some("boom".to_string()),
            },
        };
        let json = serde_json::to_string(&ev).unwrap();
        assert_eq!(
            json,
            r#"{"type":"connection_status","status":{"kind":"disconnected","reason":"boom"}}"#
        );
    }
}
