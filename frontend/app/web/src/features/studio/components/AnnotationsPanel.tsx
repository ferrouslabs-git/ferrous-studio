// Right-panel tab listing a wireframe's notes or tasks (one component, two
// kinds): a composer bound to the current canvas selection, search and
// filters over the whole wireframe, and rows that jump to their target.
// Annotations are REST state outside the op/undo system, so every mutation
// is a call up to StudioPage followed by a reload.
import { useMemo, useState } from "react";
import { formatDateTime, parseUtcDate } from "../../../core/format";
import {
  AnnotationKind,
  annotationRef,
  AnnotationTargetKind,
  WireframeAnnotation,
} from "../../project/wireframes/annotationsApi";
import type { PageSummary } from "../../projects/projectsApi";
import type { HotMark } from "./Canvas";

/** What the composer will pin a new annotation to, derived from the canvas
 *  selection. A scalar-prop selection falls back to its component, which the
 *  label makes visible. */
export interface ComposerTarget {
  pageId: string;
  kind: AnnotationTargetKind;
  targetId: string;
  /** Owning component; element targets only. */
  cmpId: string | null;
  label: string;
}

/** How an annotation's target resolves right now: present on a canvas
 *  document ("live"), verifiably gone ("orphan"), or on a page not loaded
 *  ("unknown" — the stored label stands in). */
export interface TargetInfo {
  state: "live" | "orphan" | "unknown";
  label: string;
}

interface Props {
  kind: AnnotationKind;
  /** Already filtered to this tab's kind, newest first. */
  items: WireframeAnnotation[];
  loading: boolean;
  error: string | null;
  pages: PageSummary[];
  activePageId: string | null;
  composerTarget: ComposerTarget | null;
  canWrite: boolean;
  describeTarget(a: WireframeAnnotation): TargetInfo;
  /** Two-way hover link with the canvas: the target hovered on either side.
   *  A hovered row reports here (lighting its canvas marker); a hovered
   *  canvas badge arrives here (lighting the matching rows). */
  hotTarget?: HotMark | null;
  onHoverTarget?(mark: HotMark | null): void;
  onCreate(text: string): Promise<void>;
  onEdit(a: WireframeAnnotation, text: string): void;
  onDelete(a: WireframeAnnotation): void;
  onResolve(a: WireframeAnnotation, resolved: boolean): void;
  onJump(a: WireframeAnnotation): void;
}

const DATE_RANGES: { value: string; label: string; days: number | null }[] = [
  { value: "any", label: "Any time", days: null },
  { value: "today", label: "Today", days: 1 },
  { value: "week", label: "Last 7 days", days: 7 },
  { value: "month", label: "Last 30 days", days: 30 },
];

const authorOf = (a: WireframeAnnotation): string => a.author_name || a.author_email || "Unknown user";

export function AnnotationsPanel(props: Props) {
  const { kind, items, pages, canWrite } = props;
  const task = kind === "task";
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [userFilter, setUserFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("any");
  const [thisPage, setThisPage] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"open" | "resolved" | "all">("open");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const pageName = (id: string): string | null => pages.find((p) => p.id === id)?.name ?? null;

  /** Author filter options come from the rows themselves — no extra lookup,
   *  and only people who actually wrote something are offered. */
  const users = useMemo(() => {
    const seen = new Map<string, string>();
    for (const a of items) {
      const key = a.created_by ?? "unknown";
      if (!seen.has(key)) seen.set(key, authorOf(a));
    }
    return [...seen.entries()];
  }, [items]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const days = DATE_RANGES.find((r) => r.value === dateFilter)?.days ?? null;
    const cutoff = days === null ? null : Date.now() - days * 86_400_000;
    return items.filter((a) => {
      if (task && statusFilter !== "all" && (statusFilter === "resolved") !== !!a.resolved_at) return false;
      if (thisPage && a.page_id !== props.activePageId) return false;
      if (userFilter && (a.created_by ?? "unknown") !== userFilter) return false;
      if (cutoff !== null && parseUtcDate(a.created_at).getTime() < cutoff) return false;
      if (!q) return true;
      const hay = [
        a.text,
        a.author_name ?? "",
        a.author_email ?? "",
        annotationRef(a),
        String(a.seq),
        props.describeTarget(a).label,
        a.target_label,
        pageName(a.page_id) ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, task, statusFilter, thisPage, userFilter, dateFilter, query, props.activePageId, pages]);

  const filtered =
    !!query.trim() || !!userFilter || dateFilter !== "any" || thisPage || (task && statusFilter !== "open");
  const clearFilters = () => {
    setQuery("");
    setUserFilter("");
    setDateFilter("any");
    setThisPage(false);
    setStatusFilter("open");
  };

  const submit = async () => {
    const text = draft.trim();
    if (!text || !props.composerTarget || busy) return;
    setBusy(true);
    try {
      await props.onCreate(text);
      setDraft("");
    } finally {
      setBusy(false);
    }
  };

  const noun = task ? "task" : "note";

  return (
    <div className="panel-body notes-panel">
      {canWrite && (
        <form
          className="note-composer"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="note-composer-target">
            {props.composerTarget ? props.composerTarget.label : "Nothing selected"}
          </div>
          <textarea
            className="input"
            rows={3}
            value={draft}
            aria-label={task ? "New task" : "New note"}
            disabled={!props.composerTarget || busy}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter saves; Shift+Enter inserts a newline. Ignore Enter while
              // an IME composition is being confirmed.
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void submit();
              }
            }}
          />
          <div className="insp-btn-row">
            <button className="btn small primary" disabled={!props.composerTarget || busy || !draft.trim()}>
              {busy ? "Adding…" : task ? "Add task" : "Add note"}
            </button>
          </div>
        </form>
      )}

      <div className="notes-toolbar">
        <input
          className="input search"
          type="search"
          placeholder={task ? "Search tasks" : "Search notes"}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={task ? "Search tasks" : "Search notes"}
        />
        <select className="select" value={userFilter} onChange={(e) => setUserFilter(e.target.value)} aria-label="Filter by user">
          <option value="">All users</option>
          {users.map(([id, name]) => (
            <option key={id} value={id}>{name}</option>
          ))}
        </select>
        <select className="select" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} aria-label="Filter by date">
          {DATE_RANGES.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
        {task && (
          <select
            className="select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as "open" | "resolved" | "all")}
            aria-label="Filter by status"
          >
            <option value="open">Open</option>
            <option value="resolved">Resolved</option>
            <option value="all">All</option>
          </select>
        )}
        <button
          type="button"
          className={`btn small ghost${thisPage ? " active" : ""}`}
          aria-pressed={thisPage}
          onClick={() => setThisPage((v) => !v)}
        >
          This page
        </button>
        <span className="note-count">
          {visible.length} of {items.length}
          {filtered && (
            <button type="button" className="btn small ghost" onClick={clearFilters}>Clear</button>
          )}
        </span>
      </div>

      {props.error && <div className="note-warn">{props.error}</div>}
      {props.loading && items.length === 0 ? (
        <div className="note-empty">Loading…</div>
      ) : items.length === 0 ? (
        <div className="note-empty">{task ? "No tasks yet" : "No notes yet"}</div>
      ) : visible.length === 0 ? (
        <div className="note-empty">No {noun}s match the current search and filters.</div>
      ) : (
        visible.map((a) => {
          const info = props.describeTarget(a);
          const resolved = !!a.resolved_at;
          return (
            <div
              key={a.id}
              className={`note-row${resolved ? " resolved" : ""}${
                props.hotTarget &&
                (props.hotTarget.kind === kind || props.hotTarget.kind === "both") &&
                props.hotTarget.targetId === a.target_id
                  ? " hot"
                  : ""
              }`}
              role="button"
              tabIndex={0}
              onClick={() => props.onJump(a)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && e.target === e.currentTarget) props.onJump(a);
              }}
              onMouseEnter={() => props.onHoverTarget?.({ kind, targetId: a.target_id })}
              onMouseLeave={() => props.onHoverTarget?.(null)}
            >
              <div className="note-row-head">
                <span className="note-chip">{annotationRef(a)}</span>
                <span className="note-target" title={info.label}>{info.label}</span>
                <span className="note-page">{pageName(a.page_id) ?? "Deleted page"}</span>
              </div>
              {editing?.id === a.id ? (
                <div className="note-edit" onClick={(e) => e.stopPropagation()}>
                  <textarea
                    className="input"
                    rows={3}
                    autoFocus
                    value={editing.text}
                    onChange={(e) => setEditing({ id: a.id, text: e.target.value })}
                    onKeyDown={(e) => {
                      // Enter saves; Shift+Enter inserts a newline. Ignore Enter
                      // while an IME composition is being confirmed.
                      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        const text = editing.text.trim();
                        if (!text) return;
                        if (text !== a.text) props.onEdit(a, text);
                        setEditing(null);
                      }
                    }}
                  />
                  <div className="insp-btn-row">
                    <button
                      type="button"
                      className="btn small primary"
                      disabled={!editing.text.trim()}
                      onClick={() => {
                        if (editing.text.trim() !== a.text) props.onEdit(a, editing.text.trim());
                        setEditing(null);
                      }}
                    >
                      Save
                    </button>
                    <button type="button" className="btn small ghost" onClick={() => setEditing(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="note-text">{a.text}</div>
              )}
              <div className="note-meta">
                {authorOf(a)} · {formatDateTime(a.created_at)}
              </div>
              {resolved && (
                <div className="note-meta">
                  Resolved by {a.resolver_name || a.resolver_email || "Unknown user"} · {formatDateTime(a.resolved_at!)}
                </div>
              )}
              {info.state === "orphan" && <div className="note-warn">Target no longer exists</div>}
              {canWrite && editing?.id !== a.id && (
                <div className="note-actions" onClick={(e) => e.stopPropagation()}>
                  {task && (
                    <button type="button" className="btn small ghost" onClick={() => props.onResolve(a, !resolved)}>
                      {resolved ? "Reopen" : "Resolve"}
                    </button>
                  )}
                  <button type="button" className="btn small ghost" onClick={() => setEditing({ id: a.id, text: a.text })}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn small ghost danger"
                    onClick={() => {
                      if (window.confirm(`Delete ${noun} ${annotationRef(a)}?`)) props.onDelete(a);
                    }}
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
