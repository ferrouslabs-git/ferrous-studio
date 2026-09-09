// Super admin: every organisation on the platform. Creating one here is the
// only way an organisation comes into existence (invite-only onboarding).
// The super admin does not join it -- they open it and invite its first admin.
import { FormEvent, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSession } from "../../app/session";
import { Confirmation, ConfirmationDrawer } from "../../components/ConfirmDrawer";
import { Drawer, Field } from "../../components/Drawer";
import { ListTable, NameCell } from "../../components/ListTable";
import { ListToolbar, matches } from "../../components/ListToolbar";
import { errorMessage } from "../../core/api";
import { formatDate } from "../../core/format";
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

/** "suspended" -> "Suspended": the list shows the server's word, capitalised. */
const statusLabel = (status: string) => status.charAt(0).toUpperCase() + status.slice(1);

export function AdminOrgsPage() {
  const tenants = useLoad(getPlatformTenants, []);
  const { refresh } = useSession();
  const navigate = useNavigate();
  const [mode, setMode] = useState<DrawerMode>({ kind: "closed" });
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Confirmation | null>(null);

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const all = tenants.data ?? [];
  const statuses = useMemo(() => Array.from(new Set(all.map((t) => t.status))).sort(), [all]);
  const visible = useMemo(
    () => all.filter((t) => (!statusFilter || t.status === statusFilter) && matches(query, t.name)),
    [all, query, statusFilter],
  );
  const filtered = query.trim() !== "" || statusFilter !== "";

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

  // The session's own organisation list mirrors this one, so both re-read.
  const reload = () => Promise.all([tenants.reload(), refresh()]);

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
      await reload();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const isEdit = mode.kind === "edit";
  const unchanged = isEdit && name.trim() === mode.tenant.name;

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <div className="page stack">
      <div className="page-head">
        <h1>Organisations</h1>
        <span className="shell-spacer" />
        <button className="btn primary" onClick={openCreate}>
          New organisation
        </button>
      </div>

      <ListToolbar
        search={{ value: query, onChange: setQuery, placeholder: "Search by name", label: "Search organisations" }}
        filters={[
          {
            label: "Filter by status",
            value: statusFilter,
            onChange: setStatusFilter,
            options: [{ value: "", label: "All statuses" }, ...statuses.map((s) => ({ value: s, label: statusLabel(s) }))],
          },
        ]}
        count={{ visible: visible.length, total: all.length, noun: ["organisation", "organisations"] }}
      />

      {error && <div className="status-banner warn">{error}</div>}

      <ListTable
        columns={[
          {
            header: "Organisation",
            className: "primary",
            render: (t) => <NameCell to={`/orgs/${t.tenant_id}`}>{t.name}</NameCell>,
          },
          {
            header: "Status",
            render: (t) => <span className={t.status === "active" ? "badge good" : "badge warn"}>{statusLabel(t.status)}</span>,
          },
          { header: "Members", className: "num", render: (t) => t.member_count },
          { header: "Admins", className: "num", render: (t) => t.admin_count },
          { header: "Created", className: "muted when", render: (t) => formatDate(t.created_at) },
        ]}
        rows={visible}
        rowKey={(t) => t.tenant_id}
        rowLabel={(t) => t.name}
        actions={(t) => [
          { label: "Edit", onSelect: () => openEdit(t) },
          { label: "GitHub", onSelect: () => navigate(`/orgs/${t.tenant_id}/github`) },
          { label: "Audit log", onSelect: () => navigate(`/orgs/${t.tenant_id}/audit`) },
          t.status === "active"
            ? { label: "Suspend", onSelect: () => void act(() => suspendTenant(t.tenant_id)) }
            : { label: "Unsuspend", onSelect: () => void act(() => unsuspendTenant(t.tenant_id)) },
          {
            label: "Delete",
            danger: true,
            onSelect: () =>
              setConfirming({
                title: "Delete organisation",
                body: (
                  <p>
                    Permanently delete <b>{t.name}</b> and everything in it? Its members lose access and its projects go
                    with it. This cannot be undone.
                  </p>
                ),
                run: async () => {
                  await deletePlatformTenant(t.tenant_id);
                  await reload();
                },
              }),
          },
        ]}
        loading={tenants.loading}
        error={tenants.error}
        empty={
          filtered ? (
            "No organisations match these filters."
          ) : (
            <>
              <b>No organisations yet.</b> Create the first one to start inviting people.
            </>
          )
        }
      />

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

      <ConfirmationDrawer pending={confirming} onClose={() => setConfirming(null)} />
    </div>
  );
}
