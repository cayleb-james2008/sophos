// AgentComposer — the send-to-agent relay at the foot of the detail pane.
// Mirrors the InboxView composer: textarea, Cmd/Ctrl+Enter to send, length
// counter, loading state, and a clear-plain-English send error path.
//
// Per-child composition knobs: a collapsible "composition" panel lets the
// operator override the child's thinking level and skill set per message.
// Both default from the persisted subagent policy (settings.subagentDefault*)
// and the daemon skill catalog (getRuntimeInfo), so the relay honors the
// fleet's defaults until the operator explicitly overrides them.

import { useEffect, useRef, useState } from "react";
import { Button, Text, Select } from "../../design";
import { useIpc } from "../../ipc/client";
import type { AgentRow } from "./useAgents";

interface AgentComposerProps {
  agent: AgentRow | null;
  draft: string;
  setDraft: (v: string) => void;
  sending: boolean;
  onSend: () => void;
}

const THINKING_OPTIONS = [
  { value: "none", label: "None" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

export function AgentComposer({ agent, draft, setDraft, sending, onSend }: AgentComposerProps) {
  const ipc = useIpc();
  const target = agent?.name ?? "AGENT";
  const canSend = draft.trim().length > 0 && !sending;
  const areaRef = useRef<HTMLTextAreaElement | null>(null);

  // The cua-driver e2e harness types into the textarea via UIA ValuePattern,
  // which sets the DOM value without firing React's synthetic onChange. A
  // native `input` listener (attached directly to the element) plus a short
  // polling fallback keep the draft in sync so the relay is testable by
  // computer-use. This is a no-op for normal keyboard input (onChange already
  // handles it) — it only bridges the programmatic-set path.
  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    const onNativeInput = () => {
      if (area.value !== draft) setDraft(area.value);
    };
    area.addEventListener("input", onNativeInput);
    // Polling fallback: some UIA ValuePattern implementations set the value
    // without dispatching any DOM event, so a short interval catches it.
    const poll = window.setInterval(() => {
      if (area.value !== draft) setDraft(area.value);
    }, 200);
    return () => {
      area.removeEventListener("input", onNativeInput);
      window.clearInterval(poll);
    };
  }, [draft, setDraft]);

  // Defaults come from the persisted subagent policy + the skill catalog.
  const [thinking, setThinking] = useState<string>("medium");
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [skills, setSkills] = useState<Array<{ name: string; description?: string }>>([]);
  const [skillsLoading, setSkillsLoading] = useState(true);
  const [showComposition, setShowComposition] = useState(false);

  useEffect(() => {
    let mounted = true;
    setSkillsLoading(true);
    const applySkills = (list: Array<{ name: string; description?: string }>) => {
      if (mounted) {
        setSkills(list);
        setSkillsLoading(false);
      }
    };
    const fetchSkills = (disabled?: string[]) => {
      void ipc
        .getRuntimeInfo()
        .then((info) => {
          const disabledSet = new Set(disabled ?? []);
          applySkills((info?.skills ?? [])
            .filter((sk) => !disabledSet.has(sk.name))
            .map((sk) => ({ name: sk.name, description: sk.description })));
        })
        .catch(() => applySkills([]));
    };
    ipc.getSettings().then((s) => {
      if (mounted && s.subagentDefaultThinking) setThinking(s.subagentDefaultThinking);
      fetchSkills(s.disabledSkills ?? []);
    }).catch(() => {
      // Settings unavailable — fall back to the runtime skill catalog only.
      fetchSkills();
    });
    return () => { mounted = false; };
  }, [ipc]);

  const toggleSkill = (name: string) => {
    setSelectedSkills((cur) => (cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name]));
  };

  return (
    <div className="ag-composer">
      <div className="ag-composer__label">
        <span>
          MESSAGE TO <b>{target}</b>
        </span>
        <span>⌘ ↵ TO SEND</span>
      </div>

      <button
        type="button"
        className="ag-compbtn"
        aria-expanded={showComposition}
        onClick={() => setShowComposition((v) => !v)}
      >
        <span className={`ag-compbtn__caret${showComposition ? " ag-compbtn__caret--open" : ""}`}>▸</span>
        Composition
        {thinking !== "medium" ? <span className="ag-compbtn__hint">think {thinking}</span> : null}
        {selectedSkills.length > 0 ? <span className="ag-compbtn__hint">{selectedSkills.length} skill{selectedSkills.length > 1 ? "s" : ""}</span> : null}
      </button>

      {showComposition ? (
        <div className="ag-comp">
          <div className="ag-comp__row">
            <label className="ag-comp__label">Thinking level</label>
            <Select
              aria-label="Thinking level"
              value={thinking}
              onChange={(e) => setThinking(e.target.value)}
              options={THINKING_OPTIONS}
            />
          </div>

          <div className="ag-comp__skills">
            <label className="ag-comp__label">Skills ({selectedSkills.length} selected)</label>
            {skillsLoading ? (
              <Text variant="micro" tone="dim">Loading skills…</Text>
            ) : skills.length > 0 ? (
              <div className="ag-comp__skillgrid">
                {skills.map((sk) => {
                  const on = selectedSkills.includes(sk.name);
                  return (
                    <label key={sk.name} className={`ag-skill${on ? " ag-skill--on" : ""}`}>
                      <input
                        type="checkbox"
                        className="ag-skill__checkbox"
                        checked={on}
                        onChange={() => toggleSkill(sk.name)}
                      />
                      <span className="ag-skill__name">{sk.name}</span>
                      {sk.description ? <span className="ag-skill__desc">{sk.description}</span> : null}
                    </label>
                  );
                })}
              </div>
            ) : (
              <Text variant="micro" tone="dim">
                No skills available for this session.
              </Text>
            )}
          </div>
        </div>
      ) : null}

      <textarea
        ref={areaRef}
        aria-label={`Message to ${target}`}
        className="ag-composer__area"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            if (canSend) onSend();
          }
        }}
        placeholder="Transmit a clear, bounded instruction…"
        maxLength={2000}
      />

      <div className="ag-composer__foot">
        <Text variant="micro" tone="dim" mono>
          {draft.length} / 2000
        </Text>
        <Button
          className="ag-sendbtn"
          size="sm"
          loading={sending}
          disabled={!canSend}
          onClick={onSend}
        >
          Send
        </Button>
      </div>
    </div>
  );
}
