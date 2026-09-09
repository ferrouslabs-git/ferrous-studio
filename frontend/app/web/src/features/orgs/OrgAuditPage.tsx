// Organisation ▸ Audit log: memberships, invitations and GitHub connections,
// newest first. Admin-only -- the events name invitee emails and who changed
// what. `action` is a server-side filter; there is no free-text search, the
// filter is the search. "Load more" pages further back on the keyset cursor.
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useSession } from "../../app/session";
import { ListTable } from "../../components/ListTable";
import { errorMessage } from "../../core/api";
import { formatDateTime } from "../../core/format";
import { AUDIT_ACTION_OPTIONS, describeEvent } from "./auditEvents";
import { OrgAuditEvent, listOrgAudit } from "./orgAuditApi";

const PAGE_SIZE = 50;

export function OrgAuditPage() {
  const { orgId = "" } = useParams();
  const { orgs, user } = useSession();
  const org = orgs.find((o) => o.id === orgId);
  const isPlatformAdmin = !!user?.is_platform_admin;

  const [events, setEvents] = useState<OrgAuditEvent[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setEvents([]);
    listOrgAudit(orgId, { limit: PAGE_SIZE, action: action || undefined })
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
  }, [orgId, action]);

  const loadMore = async () => {
    if (!nextBefore || loading) return;
    setLoading(true);
    try {
      const result = await listOrgAudit(orgId, { limit: PAGE_SIZE, before: nextBefore, action: action || undefined });
      setEvents((prev) => [...prev, ...result.events]);
      setHasMore(result.has_more);
      setNextBefore(result.next_before);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page stack">
      <div className="page-head">
        {/* No sidebar names the organisation for a platform admin, who has
            no organisation menu -- so the heading does it here instead. */}
        <h1>Audit log{isPlatformAdmin && org ? ` · ${org.name}` : ""}</h1>
      </div>

      <div className="toolbar">
        <select
          className="select"
          value={action}
          onChange={(e) => setAction(e.target.value)}
          aria-label="Filter by event"
        >
          {AUDIT_ACTION_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {error && <div className="status-banner warn">{error}</div>}

      <ListTable<OrgAuditEvent>
        columns={[
          { header: "When", className: "when muted", render: (e) => formatDateTime(e.timestamp) },
          {
            header: "Who",
            render: (e) => e.actor?.name || e.actor?.email || (e.actor ? "Deleted user" : "System"),
          },
          { header: "Event", className: "primary", render: (e) => describeEvent(e.action, e.metadata) },
          {
            header: "Detail",
            className: "muted",
            render: (e) =>
              AUDIT_ACTION_OPTIONS.some((o) => o.value === e.action) ? null : (
                <span className="badge muted">{e.action}</span>
              ),
          },
        ]}
        rows={events}
        rowKey={(e) => e.id}
        loading={loading && events.length === 0}
        empty={<>No activity yet.</>}
      />

      {hasMore && (
        <div className="load-more-row">
          <button className="btn" disabled={loading} onClick={() => void loadMore()}>
            {loading ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}
