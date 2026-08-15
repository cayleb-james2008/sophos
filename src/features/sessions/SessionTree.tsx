// SessionTree — the context-tree view of a session. Backed by the daemon's
// real session tree (getSessionTree → SessionTreeNode with parentId/children
// topology and a leafId), so branch points are real, not derived by grouping
// a flat transcript. Click a node to preview it, then "Continue from here" to
// tell the daemon to navigate the tree to that point (navigateTree(entryId)).
//
// In the browser preview (no daemon) the MockIpcClient returns a small demo
// tree so the view is demonstrable; in the real app an empty tree renders a
// graceful empty state.

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { Button, Text, IconButton } from "../../design";
import { useIpc } from "../../ipc/client";
import type { SessionInfo, SessionTreeNode } from "../../ipc/contract";
import { useSessionEvent } from "./useSessionEvent";
import { relativeTime } from "./format";
import { ChevronRightIcon, ForkIcon, RefreshIcon, TreeIcon, XIcon } from "./icons";
import "./sessions.css";

function snippet(node: SessionTreeNode): string {
  const text = node.label?.trim() || "(empty)";
  return text.length > 90 ? `${text.slice(0, 90)}…` : text;
}

/** Map a daemon node type onto the role badge letter / CSS class. */
function typeRole(type: string): { letter: string; cls: string } {
  switch (type) {
    case "user":
      return { letter: "U", cls: "user" };
    case "assistant":
    case "ai":
      return { letter: "A", cls: "assistant" };
    case "tool":
      return { letter: "T", cls: "tool" };
    case "system":
      return { letter: "S", cls: "system" };
    default:
      return { letter: "M", cls: "message" };
  }
}

function countBranches(nodes: SessionTreeNode[]): number {
  let n = 0;
  for (const node of nodes) {
    if (node.children && node.children.length > 0) n += 1 + countBranches(node.children);
  }
  return n;
}

export function SessionTree({ session }: { session?: SessionInfo | null }) {
  const ipc = useIpc();
  const [roots, setRoots] = useState<SessionTreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [preview, setPreview] = useState<SessionTreeNode | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const { version } = useSessionEvent(["tree", "context_tree"]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const st = await ipc.getSessionTree();
      setRoots(st.tree ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load session tree");
      setRoots([]);
    } finally {
      setLoading(false);
    }
  }, [ipc]);

  useEffect(() => {
    void load();
  }, [load]);

  // After a tree navigation event the active branch may have changed — reload.
  useEffect(() => {
    if (version > 0) void load();
  }, [version, load]);

  const toggle = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const continueFrom = async (id: string) => {
    setBusy(id);
    setToast(null);
    try {
      await ipc.navigateTree(id);
      setToast("Navigated — continue from this point in the daemon.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Tree navigation failed");
    } finally {
      setBusy(null);
    }
  };

  if (!session) {
    return (
      <div className="session-tree">
        <div className="session-tree__empty">
          <div className="radar">◈</div>
          <b>Select a session</b>
          <p>Pick a session in the graph to inspect its context tree.</p>
        </div>
      </div>
    );
  }

  const branchCount = useMemo(() => countBranches(roots), [roots]);

  return (
    <div className="session-tree">
      <div className="session-tree__toolbar">
        <span className="session-tree__label">
          <TreeIcon size={12} /> CONTEXT TREE
        </span>
        <span className="session-tree__count">
          {branchCount} branch{branchCount === 1 ? "" : "es"}
        </span>
        <Button variant="ghost" size="sm" icon={<RefreshIcon size={12} />} onClick={() => void load()} loading={loading}>
          Refresh
        </Button>
      </div>

      {error && (
        <div className="session-tree__error" role="alert">
          <Text variant="micro" tone="danger">
            ✕ {error}
          </Text>
          <Button variant="outline" className="sessions__linkbtn" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      )}

      {loading ? (
        <div className="session-tree__state">
          <span className="detail__skeleton session-tree__skeleton" />
          <span className="detail__skeleton session-tree__skeleton" />
          <span className="detail__skeleton session-tree__skeleton session-tree__skeleton--short" />
        </div>
      ) : roots.length === 0 ? (
        <div className="session-tree__state">
          <b>No tree yet</b>
          <p>This session has no entries to branch on. Send a message to start building the tree.</p>
        </div>
      ) : (
        <div className="session-tree__list">
          {roots.map((node) => (
            <TreeRow
              key={node.id}
              node={node}
              depth={0}
              collapsed={collapsed}
              onToggle={toggle}
              onSelect={setPreview}
              selectedId={preview?.id ?? null}
              busyId={busy}
              onContinue={continueFrom}
            />
          ))}
        </div>
      )}

      {toast && (
        <div className="session-tree__toast">
          <span>✓ {toast}</span>
          <IconButton title="Dismiss" size="sm" onClick={() => setToast(null)}>
            <XIcon size={12} />
          </IconButton>
        </div>
      )}

      {preview && (
        <div className="session-tree__preview">
          <div className="session-tree__preview-head">
            <span className={`session-tree__role session-tree__role--${typeRole(preview.type).cls}`}>
              {preview.type.toUpperCase()}
            </span>
            <span className="session-tree__preview-time">{preview.timestamp ? relativeTime(preview.timestamp) : ""}</span>
            <IconButton className="session-tree__preview-close" title="Close preview" size="sm" onClick={() => setPreview(null)}>
              <XIcon size={12} />
            </IconButton>
          </div>
          <p className="session-tree__preview-text">{preview.label || "(empty)"}</p>
          <div className="session-tree__preview-actions">
            <Button
              variant="primary"
              size="sm"
              icon={<ForkIcon size={13} />}
              onClick={() => void continueFrom(preview.id)}
              loading={busy === preview.id}
            >
              Continue from here
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function TreeRow({
  node,
  depth,
  collapsed,
  onToggle,
  onSelect,
  selectedId,
  busyId,
  onContinue,
}: {
  node: SessionTreeNode;
  depth: number;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  onSelect: (node: SessionTreeNode) => void;
  selectedId: string | null;
  busyId: string | null;
  onContinue: (id: string) => void;
}) {
  const children = node.children ?? [];
  const hasChildren = children.length > 0;
  const isCollapsed = collapsed.has(node.id);
  const selected = node.id === selectedId;
  const busy = node.id === busyId;
  const { letter, cls } = typeRole(node.type);

  return (
    <div className="session-tree__branch">
      <Button
        variant="ghost"
        className={`session-tree__node session-tree__node--${cls}${selected ? " session-tree__node--selected" : ""}`}
        style={{ "--depth": depth } as CSSProperties}
        onClick={() => onSelect(node)}
        title={node.label}
      >
        {hasChildren ? (
          <span
            className={`session-tree__caret${isCollapsed ? " session-tree__caret--closed" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggle(node.id);
            }}
            role="button"
            aria-label={isCollapsed ? "Expand" : "Collapse"}
          >
            <ChevronRightIcon size={11} />
          </span>
        ) : (
          <span className="session-tree__spacer" />
        )}
        <span className={`session-tree__role session-tree__role--${cls}`}>{letter}</span>
        <span className="session-tree__text">{snippet(node)}</span>
        {hasChildren && (
          <span
            className="session-tree__continue"
            role="button"
            title="Continue from this branch point"
            onClick={(e) => {
              e.stopPropagation();
              onContinue(node.id);
            }}
          >
            {busy ? "…" : "Continue"}
          </span>
        )}
      </Button>
      {hasChildren && !isCollapsed && (
        <div className="session-tree__children">
          {children.map((child) => (
            <TreeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              collapsed={collapsed}
              onToggle={onToggle}
              onSelect={onSelect}
              selectedId={selectedId}
              busyId={busyId}
              onContinue={onContinue}
            />
          ))}
        </div>
      )}
    </div>
  );
}
