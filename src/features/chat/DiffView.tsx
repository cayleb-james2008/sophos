// DiffView — renders a unified line diff for a file-edit tool call.
//
// Added lines get a terminal-green tint, removed lines a red tint, context
// lines stay dim. Monospace (Geist Mono), sharp corners, hairline borders —
// matching the Sophos design DNA. A header shows the file path with "Copy
// diff" and "Copy path" affordances (same CopyButton pattern as MessageRow).

import { useState } from "react";
import { Text, Button } from "../../design";
import type { DiffLine } from "./diff";

// CopyButton — a small icon button that copies text to the clipboard, showing
// a brief checkmark on success. Mirrors the pattern in MessageRow.tsx.
function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const [visible, setVisible] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for restricted contexts.
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {
        /* ignore */
      }
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <Button
      variant="ghost"
      type="button"
      aria-label={label}
      title={copied ? "Copied" : "Copy"}
      onClick={copy}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      className={`diff-copy ${visible || copied ? "is-visible" : ""} ${copied ? "is-copied" : ""}`}
    >
      {copied ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </Button>
  );
}

export function DiffView({
  filePath,
  lines,
  unified,
}: {
  filePath: string;
  lines: DiffLine[];
  unified: string;
}) {
  const addCount = lines.filter((l) => l.type === "add").length;
  const removeCount = lines.filter((l) => l.type === "remove").length;

  return (
    <div data-diff="true" className="diff">
      {/* Header — file path + add/remove counts + copy affordances */}
      <div className="diff-header">
        <span className="diff-file-badge">
          Δ
        </span>
        <Text variant="micro" tone="muted" mono className="diff-file-name">
          {filePath || "(unknown path)"}
        </Text>
        <Text variant="micro" tone="success" mono>
          +{addCount}
        </Text>
        <Text variant="micro" tone="danger" mono>
          −{removeCount}
        </Text>
        <CopyButton text={unified} label="Copy diff" />
        <CopyButton text={filePath} label="Copy path" />
      </div>

      {/* Lines — green added, red removed, dim context */}
      <div className="diff-body">
        {lines.map((l, i) => {
          const isAdd = l.type === "add";
          const isRemove = l.type === "remove";
          const sign = isAdd ? "+" : isRemove ? "-" : " ";
          return (
            <div
              key={i}
              data-diff-add={isAdd ? "true" : undefined}
              data-diff-remove={isRemove ? "true" : undefined}
              className={`diff-line${isAdd ? " diff-line--add" : isRemove ? " diff-line--remove" : ""}`}
            >
              <span className="diff-line-sign">
                {sign}
              </span>
              <span className={`diff-line-text${isAdd ? " diff-line-text--add" : isRemove ? " diff-line-text--remove" : ""}`}>
                {l.text || " "}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
