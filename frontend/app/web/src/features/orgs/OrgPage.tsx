// Organisation users: one list covering both members and people who have
// been invited but not yet joined. An organisation owns its projects directly,
// and membership is where access is granted -- an account_viewer sees every
// project in the organisation.
//
// Every write here is also enforced server-side; the `can*` flags only hide
// controls that would fail.
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useSession } from "../../app/session";
import { Drawer, Field } from "../../components/Drawer";
import { errorMessage } from "../../core/api";
import {
  deactivateTenantUser,
  getTenantUsers,
  inviteToTenant,
  LEGACY_TO_ACCOUNT_ROLE,
  LegacyAccountRole,
  listTenantInvitations,
  reactivateTenantUser,
  resendInvitation,
  revokeInvitation,
  TenantInvitation,
  TenantUser,
  updateTenantUser,
} from "../../core/umApi";
import { useLoad } from "../../core/useLoad";
import { RoleName, useRoles } from "./roleLabels";

export function OrgPage() {
  const { orgId = "" } = useParams();
  const { orgs, user, activeOrg, selectOrg } = useSession();
  const org = orgs.find((o) => o.id === orgId);

  // Scoped calls run under the active organisation; keep it in step with the
  // URL (deep links, back/forward). The sidebar switcher navigates here itself.
  useEffect(() => {
    if (org && activeOrg && org.id !== activeOrg.id) void selectOrg(org.id);
  }, [org, activeOrg, selectOrg]);
  const isPlatformAdmin = !!user?.is_platform_admin;

  if (!org && !isPlatformAdmin) {
    return (
      <div className="page">
        <div className="empty">You are not a member of this organisation.</div>
      </div>
    );
  }

  // Admin is the top organisation role: it both manages members and invites.
  const myRole = org?.role ?? null;
  const canManage = isPlatformAdmin || myRole === "account_admin";

  return (
    <div className="page stack">
      <div className="page-head">
        <h1>Users</h1>
      </div>

      <UsersSection orgId={orgId} currentUserId={user?.id ?? ""} canManage={canManage} />
    </div>
  );
}

// ── Users (members + open invitations) ─────────────────────────────────────

/** A user's standing in the organisation, whichever list they came from.
 *  "archived" is a membership the backend calls "removed": the account still
 *  exists, it just has no access here until restored. */
type UserStatus = "active" | "archived" | "invited" | "expired";

/** One row of the table: a member, or someone still to accept an invitation. */
type UserRow =
  | { kind: "member"; key: string; email: string; name: string | null; role: string; status: UserStatus; member: TenantUser }
  | { kind: "invite"; key: string; email: string; name: string | null; role: string; status: UserStatus; invite: TenantInvitation };

function toRows(members: TenantUser[], invites: TenantInvitation[]): UserRow[] {
  const memberRows: UserRow[] = members.map((m) => ({
    kind: "member",
    key: `m:${m.user_id}`,
    email: m.email,
    name: m.name,
    role: m.role,
    status: m.status === "active" ? "active" : "archived",
    member: m,
  }));
  // Accepted invitations already appear as members; revoked ones are history.
  const inviteRows: UserRow[] = invites
    .filter((i) => i.status === "pending" || i.status === "expired")
    .map((i) => ({
      kind: "invite",
      key: `i:${i.invitation_id}`,
      email: i.email,
      name: i.name,
      role: i.role,
      status: i.status === "pending" ? "invited" : "expired",
      invite: i,
    }));
  return [...memberRows, ...inviteRows];
}

const STATUS_LABEL: Record<UserStatus, string> = {
  active: "Active",
  archived: "Archived",
  invited: "Invited",
  expired: "Invite expired",
};
const STATUS_BADGE: Record<UserStatus, string> = {
  active: "badge good",
  archived: "badge",
  invited: "badge accent",
  expired: "badge",
};

function UsersSection({
  orgId,
  currentUserId,
  canManage,
}: {
  orgId: string;
  currentUserId: string;
  canManage: boolean;
}) {
  const members = useLoad(() => getTenantUsers(orgId, "all"), [orgId]);
  const invites = useLoad(() => listTenantInvitations(orgId), [orgId]);
  const { byName } = useRoles();

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<TenantUser | null>(null);

  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | UserStatus>("");

  const rows = useMemo(() => toRows(members.data ?? [], invites.data ?? []), [members.data, invites.data]);
  const roles = useMemo(() => Array.from(new Set(rows.map((r) => r.role))).sort(), [rows]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (roleFilter && r.role !== roleFilter) return false;
      if (statusFilter && r.status !== statusFilter) return false;
      if (!q) return true;
      const roleLabel = (byName[r.role]?.display_name ?? r.role).toLowerCase();
      return r.email.toLowerCase().includes(q) || (r.name ?? "").toLowerCase().includes(q) || roleLabel.includes(q);
    });
  }, [rows, query, roleFilter, statusFilter, byName]);

  const reload = () => Promise.all([members.reload(), invites.reload()]);

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const loading = members.loading || invites.loading;
  const loadError = members.error ?? invites.error;
  const filtered = query.trim() !== "" || roleFilter !== "" || statusFilter !== "";
  const clearFilters = () => {
    setQuery("");
    setRoleFilter("");
    setStatusFilter("");
  };

  return (
    <section className="section">
      <div className="section-head">
        <h2>Users</h2>
        <span className="muted">{filtered ? `${visible.length} of ${rows.length}` : rows.length}</span>
        <span className="shell-spacer" />
        {canManage && (
          <InviteButton
            orgId={orgId}
            onInvited={(msg) => {
              setNotice(msg);
              void reload();
            }}
          />
        )}
      </div>

      <div className="toolbar">
        <input
          className="input search"
          type="search"
          placeholder="Search by email, name or role"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search users"
        />
        <select
          className="select"
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          aria-label="Filter by role"
        >
          <option value="">All roles</option>
          {roles.map((r) => (
            <option key={r} value={r}>
              {byName[r]?.display_name ?? r.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <select
          className="select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as "" | UserStatus)}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          {(Object.keys(STATUS_LABEL) as UserStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        {filtered && (
          <button type="button" className="btn small ghost" onClick={clearFilters}>
            Clear
          </button>
        )}
      </div>

      {notice && <div className="status-banner">{notice}</div>}
      {error && <div className="status-banner warn">{error}</div>}

      <EditUserDrawer
        orgId={orgId}
        user={editing}
        canChangeRole={editing !== null && editing.user_id !== currentUserId}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void reload();
        }}
      />

      {loading ? (
        <div className="empty">Loading…</div>
      ) : loadError ? (
        <div className="empty error">{loadError}</div>
      ) : visible.length === 0 ? (
        <div className="empty">{filtered ? "No users match these filters." : "No users yet."}</div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Name</th>
              <th>Role</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const isSelf = r.kind === "member" && r.member.user_id === currentUserId;
              return (
                <tr key={r.key}>
                  <td>{r.email}</td>
                  <td className="muted">{r.name ?? "—"}</td>
                  <td>
                    <RoleName name={r.role} />
                  </td>
                  <td>
                    <span
                      className={STATUS_BADGE[r.status]}
                      title={r.kind === "invite" ? `Expires ${new Date(r.invite.expires_at).toLocaleDateString()}` : undefined}
                    >
                      {STATUS_LABEL[r.status]}
                    </span>
                  </td>
                  <td className="actions">
                    {canManage && r.kind === "member" && r.status === "active" && (
                      <>
                        <button className="btn small ghost" disabled={busy === r.key} onClick={() => setEditing(r.member)}>
                          Edit
                        </button>{" "}
                      </>
                    )}
                    {canManage && r.kind === "member" && !isSelf && r.status === "active" && (
                      <button
                        className="btn small ghost"
                        disabled={busy === r.key}
                        onClick={() => {
                          if (confirm(`Archive ${r.email}? They will lose access to this organisation until restored.`)) {
                            void act(r.key, () => deactivateTenantUser(orgId, r.member.user_id));
                          }
                        }}
                      >
                        Archive
                      </button>
                    )}
                    {canManage && r.kind === "member" && r.status === "archived" && (
                      <button
                        className="btn small ghost"
                        disabled={busy === r.key}
                        onClick={() => void act(r.key, () => reactivateTenantUser(orgId, r.member.user_id))}
                      >
                        Restore
                      </button>
                    )}
                    {canManage && r.kind === "invite" && (
                      <>
                        <button
                          className="btn small ghost"
                          disabled={busy === r.key}
                          onClick={() => void act(r.key, () => resendInvitation(orgId, r.invite.invitation_id))}
                        >
                          Resend
                        </button>{" "}
                        <button
                          className="btn small ghost"
                          disabled={busy === r.key}
                          onClick={() => void act(r.key, () => revokeInvitation(orgId, r.invite.invitation_id))}
                        >
                          Revoke
                        </button>
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
  );
}

function legacyOf(roleName: string): LegacyAccountRole {
  const found = (Object.entries(LEGACY_TO_ACCOUNT_ROLE) as [LegacyAccountRole, string][]).find(
    ([, v]) => v === roleName,
  );
  return found?.[0] ?? "member";
}

// ── Edit user ──────────────────────────────────────────────────────────────

function EditUserDrawer({
  orgId,
  user,
  canChangeRole,
  onClose,
  onSaved,
}: {
  orgId: string;
  user: TenantUser | null;
  /** You cannot change your own role (an admin could lock themselves out). */
  canChangeRole: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [role, setRole] = useState<LegacyAccountRole>("member");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset the form each time a different user is opened.
  useEffect(() => {
    if (user) {
      setName(user.name ?? "");
      setRole(legacyOf(user.role));
      setError(null);
    }
  }, [user]);

  if (!user) return null;

  const nameChanged = name.trim() !== (user.name ?? "");
  const roleChanged = canChangeRole && role !== legacyOf(user.role);
  const unchanged = !nameChanged && !roleChanged;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await updateTenantUser(orgId, user.user_id, {
        ...(nameChanged ? { name: name.trim() } : {}),
        ...(roleChanged ? { role } : {}),
      });
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open
      title="Edit user"
      description={user.email}
      onClose={onClose}
      onSubmit={save}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={saving || unchanged}>
            {saving ? "Saving…" : "Save changes"}
          </button>
        </>
      }
    >
      <Field label="Name" hint="Shown wherever this user appears. Leave blank to clear.">
        <input className="input" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field
        label="Role"
        hint={
          canChangeRole
            ? "Admins manage users and invitations; members create and edit projects; viewers have read-only access."
            : "You cannot change your own role."
        }
      >
        <select
          className="select"
          value={role}
          disabled={!canChangeRole}
          onChange={(e) => setRole(e.target.value as LegacyAccountRole)}
        >
          {(Object.keys(LEGACY_TO_ACCOUNT_ROLE) as LegacyAccountRole[]).map((lr) => (
            <option key={lr} value={lr}>
              {LEGACY_TO_ACCOUNT_ROLE[lr].replace("account_", "")}
            </option>
          ))}
        </select>
      </Field>
      {error && <div className="status-banner warn">{error}</div>}
    </Drawer>
  );
}

// ── Invite ─────────────────────────────────────────────────────────────────

function InviteButton({ orgId, onInvited }: { orgId: string; onInvited: (notice: string) => void }) {
  const { byLayer } = useRoles();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("account_member");
  const [open, setOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const openDrawer = () => {
    setEmail("");
    setName("");
    setRole("account_member");
    setFormError(null);
    setOpen(true);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSending(true);
    setFormError(null);
    try {
      const created = await inviteToTenant(orgId, email.trim(), role, name.trim());
      setOpen(false);
      onInvited(created.email_sent ? `Invitation sent to ${created.email}.` : created.message);
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <button className="btn small primary" onClick={openDrawer}>
        Invite user
      </button>
      <Drawer
        open={open}
        title="Invite user"
        description="They will receive an email with a link to join this organisation."
        onClose={() => setOpen(false)}
        onSubmit={submit}
        footer={
          <>
            <button type="button" className="btn ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="btn primary" disabled={sending || !email.trim()}>
              {sending ? "Sending…" : "Send invitation"}
            </button>
          </>
        }
      >
        <Field label="Email address">
          <input
            className="input"
            type="email"
            required
            placeholder="name@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Name" hint="Optional. Shown in the Users list and used for their account.">
          <input
            className="input"
            autoComplete="off"
            placeholder="e.g. Sam Taylor"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field
          label="Role"
          hint="Admins manage users and invitations; members create and edit projects; viewers have read-only access."
        >
          <select className="select" value={role} onChange={(e) => setRole(e.target.value)}>
            {(byLayer.account ?? []).map((r) => (
              <option key={r.name} value={r.name}>
                {r.display_name}
              </option>
            ))}
          </select>
        </Field>
        {formError && <div className="status-banner warn">{formError}</div>}
      </Drawer>
    </>
  );
}
