// Super admin: every user on the platform, with promote/demote and
// suspend/unsuspend. Promotion here is the audited path once the first
// platform admin exists (see backend/scripts/bootstrap_admin.py).
import { useState } from "react";
import { Link } from "react-router-dom";
import { useSession } from "../../app/session";
import { errorMessage } from "../../core/api";
import {
  demoteUser,
  getAuditEvents,
  getPlatformUsers,
  promoteUser,
  suspendUser,
  unsuspendUser,
} from "../../core/umApi";
import { useLoad } from "../../core/useLoad";

export function AdminUsersPage() {
  const users = useLoad(getPlatformUsers, []);
  const audit = useLoad(() => getAuditEvents(30), []);
  const { user: me } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id);
    setError(null);
    try {
      await fn();
      await Promise.all([users.reload(), audit.reload()]);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="page stack">
      <div className="page-head">
        <h1>All users</h1>
        <span className="shell-spacer" />
        <Link to="/admin/orgs" className="btn">
          All organisations
        </Link>
      </div>
      {error && <div className="status-banner warn">{error}</div>}

      <section className="section">
        <div className="section-head">
          <h2>Users</h2>
          <span className="muted">{users.data?.length ?? 0}</span>
        </div>
        {users.loading ? (
          <div className="empty">Loading…</div>
        ) : users.error ? (
          <div className="empty error">{users.error}</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Name</th>
                <th>Memberships</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.data?.map((u) => {
                const isSelf = u.user_id === me?.id;
                return (
                  <tr key={u.user_id}>
                    <td>
                      {u.email} {u.is_platform_admin && <span className="badge accent">super admin</span>}
                    </td>
                    <td className="muted">{u.name ?? "—"}</td>
                    <td className="muted">
                      {u.memberships.length === 0
                        ? "none (pending)"
                        : u.memberships
                            .filter((m) => m.scope_type !== "space")
                            .map((m) => m.tenant_name ?? m.scope_id)
                            .join(", ")}
                    </td>
                    <td>
                      <span className={`badge ${u.is_active ? "good" : ""}`}>
                        {u.is_active ? "active" : "suspended"}
                      </span>
                    </td>
                    <td className="actions">
                      {!isSelf && (
                        <>
                          {u.is_platform_admin ? (
                            <button
                              className="btn small ghost"
                              disabled={busy === u.user_id}
                              onClick={() => void act(u.user_id, () => demoteUser(u.user_id))}
                            >
                              Demote
                            </button>
                          ) : (
                            <button
                              className="btn small ghost"
                              disabled={busy === u.user_id}
                              onClick={() => void act(u.user_id, () => promoteUser(u.user_id))}
                            >
                              Make super admin
                            </button>
                          )}{" "}
                          {u.is_active ? (
                            <button
                              className="btn small ghost"
                              disabled={busy === u.user_id}
                              onClick={() => void act(u.user_id, () => suspendUser(u.user_id))}
                            >
                              Suspend
                            </button>
                          ) : (
                            <button
                              className="btn small ghost"
                              disabled={busy === u.user_id}
                              onClick={() => void act(u.user_id, () => unsuspendUser(u.user_id))}
                            >
                              Unsuspend
                            </button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Recent audit events</h2>
        </div>
        {audit.loading ? (
          <div className="empty">Loading…</div>
        ) : audit.error ? (
          <div className="empty error">{audit.error}</div>
        ) : (
          <table className="data-table">
            <tbody>
              {audit.data?.map((e) => (
                <tr key={e.id}>
                  <td className="muted">{new Date(e.timestamp).toLocaleString()}</td>
                  <td>{e.action}</td>
                  <td className="muted">{e.target_type ? `${e.target_type} ${e.target_id ?? ""}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
