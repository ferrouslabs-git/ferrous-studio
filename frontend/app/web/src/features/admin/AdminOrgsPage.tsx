// Super admin: every organisation on the platform. Creating one here is the
// only way an organisation comes into existence (invite-only onboarding).
// The super admin does not join it -- they open it and invite its first admin.
import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { useSession } from "../../app/session";
import { Drawer, Field } from "../../components/Drawer";
import { errorMessage } from "../../core/api";
import {
  createTenant,
  deletePlatformTenant,
  getPlatformTenants,
  PlatformTenant,
  suspendTenant,
  unsuspendTenant,
  updateTenant,
} from "../../core/umApi";
import { useLoad } from "../../core/useLoad";

type DrawerMode = { kind: "closed" } | { kind: "create" } | { kind: "edit"; tenant: PlatformTenant };

export function AdminOrgsPage() {
  const tenants = useLoad(getPlatformTenants, []);
  const { refresh } = useSession();
  const [mode, setMode] = useState<DrawerMode>({ kind: "closed" });
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const close = () => setMode({ kind: "closed" });

  const openCreate = () => {
    setName("");
    setFormError(null);
    setMode({ kind: "create" });
  };

  const openEdit = (tenant: PlatformTenant) => {
    setName(tenant.name);
    setFormError(null);
    setMode({ kind: "edit", tenant });
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      if (mode.kind === "edit") {
        await updateTenant(mode.tenant.tenant_id, { name: name.trim() });
      } else {
        await createTenant(name.trim());
      }
      close();
      await Promise.all([tenants.reload(), refresh()]);
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const isEdit = mode.kind === "edit";
  const unchanged = isEdit && name.trim() === mode.tenant.name;

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
        <h1>Organisations</h1>
        <span className="sub">{tenants.data?.length ?? 0} on the platform</span>
        <span className="shell-spacer" />
        <button className="btn primary" onClick={openCreate}>
          New organisation
        </button>
      </div>

      {error && <div className="status-banner warn">{error}</div>}

      <section className="section">
        {tenants.loading ? (
          <div className="empty">Loading…</div>
        ) : tenants.error ? (
          <div className="empty error">{tenants.error}</div>
        ) : tenants.data?.length === 0 ? (
          <div className="empty">
            <b>No organisations yet.</b> Create the first one to start inviting people.
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Members</th>
                <th>Admins</th>
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
                  <td>
                    <span className={`badge ${t.status === "active" ? "good" : ""}`}>{t.status}</span>
                  </td>
                  <td>{t.member_count}</td>
                  <td>{t.admin_count}</td>
                  <td className="muted">{new Date(t.created_at).toLocaleDateString()}</td>
                  <td className="actions">
                    <button className="btn small ghost" disabled={busy === t.tenant_id} onClick={() => openEdit(t)}>
                      Edit
                    </button>{" "}
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

      <Drawer
        open={mode.kind !== "closed"}
        title={isEdit ? "Edit organisation" : "New organisation"}
        description={
          isEdit
            ? "Changes apply immediately for every member."
            : "Organisations are invite-only. Once created, open it and invite its first admin."
        }
        onClose={close}
        onSubmit={save}
        footer={
          <>
            <button type="button" className="btn ghost" onClick={close}>
              Cancel
            </button>
            <button className="btn primary" disabled={saving || !name.trim() || unchanged}>
              {saving ? "Saving…" : isEdit ? "Save changes" : "Create organisation"}
            </button>
          </>
        }
      >
        <Field label="Name" hint="Shown to members everywhere.">
          <input
            className="input"
            required
            placeholder="e.g. Acme Ltd"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        {formError && <div className="status-banner warn">{formError}</div>}
      </Drawer>
    </div>
  );
}
