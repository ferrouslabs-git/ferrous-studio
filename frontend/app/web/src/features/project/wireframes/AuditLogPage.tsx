// A wireframe's audit log: annotation events and wireframe changes, newest
// first. Canvas edits arrive pre-coalesced (one row per user per page per
// editing session — see backend app/studio/audit.py), so the table stays
// readable; "Load more" pages further back on the keyset cursor. Search and
// filters apply to the rows loaded so far.
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { errorMessage } from "../../../core/api";
import { formatDateTime, parseUtcDate } from "../../../core/format";
import { useLoad } from "../../../core/useLoad";
import { useProject } from "../ProjectLayout";
import { AUDIT_EVENT_GROUPS, AUDIT_EVENT_LABELS, AuditEvent, listWireframeAudit } from "./auditApi";
import { getWireframe } from "./wireframesApi";

const PAGE_SIZE = 50;

/** One sentence per event, filled from the row's detail snapshot. */
function eventText(e: AuditEvent): string {
  const d = e.detail as Record<string, unknown>;
  const name = (key: string): string => String(d[key] ?? "").trim();
  switch (e.event) {
    case "page_edited": {
      const batches = Number(d.batches ?? 1);
      return `Edited page ${name("page_name")}`.trim() + (batches > 1 ? ` · ${batches} changes` : "");
    }
    case "page_added":
      return `Added page ${name("page_name")}`.trim();
    case "page_deleted":
      return `Deleted page ${name("page_name")}`.trim();
    case "page_renamed":
      return `Renamed page ${name("old_name")} → ${name("new_name")}`;
    case "wireframe_renamed":
      return `Renamed wireframe ${name("old_name")} → ${name("new_name")}`;
    case "snapshot_saved":
      return name("label") ? `Saved snapshot "${name("label")}"` : "Saved snapshot";
    case "snapshot_restored":
      return name("label") ? `Restored snapshot "${name("label")}"` : "Restored snapshot";
    case "snapshot_copied": {
      const snap = name("label") ? `snapshot "${name("label")}"` : "a snapshot";
      return `Created wireframe ${name("wireframe_name")} from ${snap}`;
    }
    default: {
      const label = AUDIT_EVENT_LABELS[e.event] ?? e.event;
      const seq = d.seq;
      const ref = seq == null ? "" : ` ${e.event.startsWith("task") ? "T" : "N"}-${seq}`;
      return `${label}${ref}`;
    }
  }
}

/** The stored text excerpt a note/task event carries, for the muted second line. */
function eventExcerpt(e: AuditEvent): string | null {
  const d = e.detail as Record<string, unknown>;
  const text = d.excerpt ?? d.text;
  return typeof text === "string" && text.trim() ? text : null;
}

export function AuditLogPage() {
  const { wireframeId = "" } = useParams();
  const { project, orgId } = useProject();
  const wireframe = useLoad(() => getWireframe(project.id, wireframeId), [project.id, wireframeId]);
  const pages = wireframe.data?.pages ?? [];

  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
  const [userFilter, setUserFilter] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setEvents([]);
    listWireframeAudit(project.id, wireframeId, { limit: PAGE_SIZE })
      .then((result) => {
        if (cancelled) return;
        setEvents(result.events);
        setHasMore(result.has_more);
        setNextBefore(result.next_before);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(errorMessage(err));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [project.id, wireframeId]);

  const loadMore = async () => {
    if (!nextBefore || loading) return;
    setLoading(true);
    try {
      const result = await listWireframeAudit(project.id, wireframeId, { limit: PAGE_SIZE, before: nextBefore });
      setEvents((prev) => [...prev, ...result.events]);
      setHasMore(result.has_more);
      setNextBefore(result.next_before);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const users = useMemo(() => {
    const seen = new Map<string, string>();
    for (const e of events) {
      const key = e.user_id ?? "unknown";
      if (!seen.has(key)) seen.set(key, e.user_name || e.user_email || "Unknown user");
    }
    return [...seen.entries()];
  }, [events]);

  const pageNameOf = (e: AuditEvent): string => {
    const live = e.page_id ? pages.find((p) => p.id === e.page_id)?.name : null;
    if (live) return live;
    const stored = String((e.detail as Record<string, unknown>).page_name ?? "").trim();
    if (stored) return e.page_id && !pages.some((p) => p.id === e.page_id) ? `${stored} (deleted)` : stored;
    return "—";
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const group = AUDIT_EVENT_GROUPS.find((g) => g.value === groupFilter);
    return events.filter((e) => {
      if (group && !group.events.includes(e.event)) return false;
      if (userFilter && (e.user_id ?? "unknown") !== userFilter) return false;
      if (!q) return true;
      return [eventText(e), eventExcerpt(e) ?? "", e.user_name ?? "", e.user_email ?? "", pageNameOf(e)]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, query, groupFilter, userFilter, pages]);

  const filtered = !!query.trim() || !!groupFilter || !!userFilter;
  const base = `/orgs/${orgId}/projects/${project.id}/wireframes`;

  return (
    <div className="page stack">
      <div className="page-head">
        <h1>Audit log{wireframe.data ? ` · ${wireframe.data.name}` : ""}</h1>
        <span className="shell-spacer" />
        <Link to={base} className="btn">
          Back to wireframes
        </Link>
      </div>

      <div className="toolbar">
        <input
          className="input search"
          type="search"
          placeholder="Search by event, user or page"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search the audit log"
        />
        <select className="select" value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)} aria-label="Filter by event type">
          <option value="">All events</option>
          {AUDIT_EVENT_GROUPS.map((g) => (
            <option key={g.value} value={g.value}>
              {g.label}
            </option>
          ))}
        </select>
        <select className="select" value={userFilter} onChange={(e) => setUserFilter(e.target.value)} aria-label="Filter by user">
          <option value="">All users</option>
          {users.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <span className="muted">
          {visible.length} of {events.length} loaded
        </span>
        {filtered && (
          <button
            className="btn small ghost"
            onClick={() => {
              setQuery("");
              setGroupFilter("");
              setUserFilter("");
            }}
          >
            Clear
          </button>
        )}
      </div>

      {error && (
        <div className="status-banner warn">
          {error}{" "}
          <button className="btn small ghost" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      <section className="section">
        {loading && events.length === 0 ? (
          <div className="empty">Loading…</div>
        ) : events.length === 0 ? (
          <div className="empty">
            <b>No activity yet.</b> Changes to this wireframe and its notes and tasks appear here.
          </div>
        ) : visible.length === 0 ? (
          <div className="empty">No events match the current search and filters.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>User</th>
                <th>Event</th>
                <th>Page</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((e) => {
                const excerpt = eventExcerpt(e);
                // A coalesced editing session spans created_at → updated_at.
                const ongoing =
                  parseUtcDate(e.updated_at).getTime() - parseUtcDate(e.created_at).getTime() > 60_000;
                return (
                  <tr key={e.id}>
                    <td className="muted">
                      {formatDateTime(e.created_at)}
                      {ongoing && ` – ${formatDateTime(e.updated_at)}`}
                    </td>
                    <td>{e.user_name || e.user_email || "Unknown user"}</td>
                    <td>
                      {eventText(e)}
                      {excerpt && <div className="muted">{excerpt}</div>}
                    </td>
                    <td className="muted">{pageNameOf(e)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {hasMore && (
          <div className="load-more-row">
            <button className="btn" disabled={loading} onClick={() => void loadMore()}>
              {loading ? "Loading…" : "Load more"}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
