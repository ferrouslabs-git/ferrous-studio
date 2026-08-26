// Super admin: every organisation on the platform. Creating one here is the
// only way an organisation comes into existence (invite-only onboarding);
// the creator is recorded as its first owner and then invites the real one.
import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { useSession } from "../../app/session";
import { errorMessage } from "../../core/api";
import {
  createTenant,
  deletePlatformTenant,
  getPlatformTenants,
  suspendTenant,
  unsuspendTenant,
} from "../../core/umApi";
import { useLoad } from "../../core/useLoad";

export function AdminOrgsPage() {
  const tenants = useLoad(getPlatformTenants, []);
  const { refresh } = useSession();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await createTenant(name.trim());
      setName("");
      await Promise.all([tenants.reload(), refresh()]);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id);
    setError(null);
    try {
      await fn();
      await Promise.all([tenants.reload(), refresh()]);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="page stack">
      <div className="page-head">
        <h1>All organisations</h1>
        <span className="shell-spacer" />
        <Link to="/admin/users" className="btn">
          All users
        </Link>
      </div>

      <section className="section">
        <div className="section-head">
          <h2>Create organisation</h2>
        </div>
        <form className="section-body row" onSubmit={create}>
          <input
            className="input"
            required
            placeholder="Organisation name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button className="btn primary">Create</button>
          <span className="muted">Then open it and invite its owner.</span>
        </form>
        {error && <div className="status-banner warn">{error}</div>}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Organisations</h2>
          <span className="muted">{tenants.data?.length ?? 0}</span>
        </div>
        {tenants.loading ? (
          <div className="empty">Loading…</div>
        ) : tenants.error ? (
          <div className="empty error">{tenants.error}</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Plan</th>
                <th>Status</th>
                <th>Members</th>
                <th>Owners</th>
                <th>Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tenants.data?.map((t) => (
                <tr key={t.tenant_id}>
                  <td>
                    <Link to={`/orgs/${t.tenant_id}`}>{t.name}</Link>
                  </td>
                  <td className="muted">{t.plan}</td>
                  <td>
                    <span className={`badge ${t.status === "active" ? "good" : ""}`}>{t.status}</span>
                  </td>
                  <td>{t.member_count}</td>
                  <td>{t.owner_count}</td>
                  <td className="muted">{new Date(t.created_at).toLocaleDateString()}</td>
                  <td className="actions">
                    {t.status === "active" ? (
                      <button
                        className="btn small ghost"
                        disabled={busy === t.tenant_id}
                        onClick={() => void act(t.tenant_id, () => suspendTenant(t.tenant_id))}
                      >
                        Suspend
                      </button>
                    ) : (
                      <button
                        className="btn small ghost"
                        disabled={busy === t.tenant_id}
                        onClick={() => void act(t.tenant_id, () => unsuspendTenant(t.tenant_id))}
                      >
                        Unsuspend
                      </button>
                    )}{" "}
                    <button
                      className="btn small ghost"
                      disabled={busy === t.tenant_id}
                      onClick={() => {
                        if (confirm(`Permanently delete "${t.name}" and everything in it?`)) {
                          void act(t.tenant_id, () => deletePlatformTenant(t.tenant_id));
                        }
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
