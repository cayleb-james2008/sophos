// DiffView — renders a unified diff (added / removed / context lines) in the
// Sophos visual language: terminal-green additions, red removals, monospace,
// hairline rules, zero radius. Shared by the RefinementGateBanner and the
// RefinementHistory panel.

import type { DiffLine } from "./diff";
import "./longrunning.css";

export function DiffView({ lines }: { lines: DiffLine[] }) {
  return (
    <div className="lr-diff">
      {lines.map((l, i) => {
        const marker = l.type === "add" ? "+" : l.type === "del" ? "-" : " ";
        const variant = l.type === "add" ? " lr-diff-line--add" : l.type === "del" ? " lr-diff-line--del" : "";
        return (
          <div key={i} className={`lr-diff-line${variant}`}>
            <span className="lr-diff-marker">
              {marker}
            </span>
            <span>{l.text || " "}</span>
          </div>
        );
      })}
    </div>
  );
}

export default DiffView;
