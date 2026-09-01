// Super admin: every user on the platform in one list, alongside people who
// have been invited to an organisation but not yet joined. Mirrors the
// organisation Users page (features/orgs/OrgPage.tsx) but spans every
// organisation: filters by organisation rather than role, and the invite
// form picks which organisation to invite into.
//
// Every write here is also enforced server-side (platform admin only).
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useSession } from "../../app/session";
import { Drawer, Field } from "../../components/Drawer";
import { errorMessage } from "../../core/api";
import {
  deletePlatformUser,
  demoteUser,
  getAuditEvents,
  getPlatformInvitations,
  getPlatformTenants,
  getPlatformUsers,
  inviteToTenant,
  PlatformInvitation,
  PlatformTenant,
  PlatformUser,
  promoteUser,
  resendInvitation,
  revokeInvitation,
  suspendUser,
  unsuspendUser,
  updatePlatformUser,
} from "../../core/umApi";
import { useLoad } from "../../core/useLoad";
import { RoleName, useRoles } from "../orgs/roleLabels";

// ── Rows (users + open invitations) ────────────────────────────────────────

/** A person's standing on the platform, whichever list they came from. */
type UserStatus = "active" | "suspended" | "invited" | "expired";

/** One organisation a row is connected to, with the role there. */
interface OrgLink {
  id: string;
  name: string;
  role: string;
  /** Membership status; invitations are always "pending". */
  status: string;
}

type UserRow =
  | { kind: "user"; key: string; email: string; name: string | null; status: UserStatus; orgs: OrgLink[]; user: PlatformUser }
  | {
      kind: "invite";
      key: string;
      email: string;
      name: string | null;
      status: UserStatus;
      orgs: OrgLink[];
      invite: PlatformInvitation;
    };

function toRows(users: PlatformUser[], invites: PlatformInvitation[]): UserRow[] {
  const userRows: UserRow[] = users.map((u) => ({
    kind: "user",
    key: `u:${u.user_id}`,
    email: u.email,
    name: u.name,
    status: u.is_active ? "active" : "suspended",
    orgs: u.memberships
      .filter((m) => m.tenant_id)
      .map((m) => ({ id: m.tenant_id!, name: m.tenant_name ?? m.tenant_id!, role: m.role, status: m.status })),
    user: u,
  }));
  // Accepted invitations already appear as users; revoked ones are history.
  const inviteRows: UserRow[] = invites
    .filter((i) => i.status === "pending" || i.status === "expired")
    .map((i) => ({
      kind: "invite",
      key: `i:${i.invitation_id}`,
      email: i.email,
      name: i.name,
      status: i.status === "pending" ? "invited" : "expired",
      orgs: [{ id: i.tenant_id, name: i.tenant_name ?? i.tenant_id, role: i.role, status: "pending" }],
      invite: i,
    }));
  return [...userRows, ...inviteRows];
}

const STATUS_LABEL: Record<UserStatus, string> = {
  active: "Active",
  suspended: "Suspended",
  invited: "Invited",
  expired: "Invite expired",
};
const STATUS_BADGE: Record<UserStatus, string> = {
  active: "badge good",
  suspended: "badge warn",
  invited: "badge accent",
  expired: "badge",
};

// ── Page ───────────────────────────────────────────────────────────────────

export function AdminUsersPage() {
  const users = useLoad(getPlatformUsers, []);
  const invites = useLoad(getPlatformInvitations, []);
  const tenants = useLoad(getPlatformTenants, []);
  const audit = useLoad(() => getAuditEvents(30), []);
  const { user: me } = useSession();
  const { byName } = useRoles();

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<PlatformUser | null>(null);

  const [query, setQuery] = useState("");
  const [orgFilter, setOrgFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | UserStatus>("");

  const rows = useMemo(() => toRows(users.data ?? [], invites.data ?? []), [users.data, invites.data]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (orgFilter === "none" && r.orgs.length > 0) return false;
      if (orgFilter && orgFilter !== "none" && !r.orgs.some((o) => o.id === orgFilter)) return false;
      if (statusFilter && r.status !== statusFilter) return false;
      if (!q) return true;
      const haystack = [
        r.email,
        r.name ?? "",
        r.kind === "user" && r.user.is_platform_admin ? "super admin" : "",
        ...r.orgs.flatMap((o) => [o.name, byName[o.role]?.display_name ?? o.role]),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [rows, query, orgFilter, statusFilter, byName]);

  const reload = () => Promise.all([users.reload(), invites.reload(), tenants.reload(), audit.reload()]);

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await fn();
      await reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const loading = users.loading || invites.loading;
  const loadError = users.error ?? invites.error;
  const filtered = query.trim() !== "" || orgFilter !== "" || statusFilter !== "";
  const clearFilters = () => {
    setQuery("");
    setOrgFilter("");
    setStatusFilter("");
  };

  return (
    <div className="page stack">
      <div className="page-head">
        <h1>Users</h1>
        <span className="sub">{users.data?.length ?? 0} on the platform</span>
        <span className="shell-spacer" />
        <InviteButton
          tenants={tenants.data ?? []}
          onInvited={(msg) => {
            setNotice(msg);
            setError(null);
            void reload();
          }}
        />
      </div>

      <section className="section">
        <div className="section-head">
          <h2>Users</h2>
          <span className="muted">{filtered ? `${visible.length} of ${rows.length}` : rows.length}</span>
        </div>

        <div className="toolbar">
          <input
            className="input search"
            type="search"
            placeholder="Search by email, name, organisation or role"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search users"
          />
          <select
            className="select"
            value={orgFilter}
            onChange={(e) => setOrgFilter(e.target.value)}
            aria-label="Filter by organisation"
          >
            <option value="">All organisations</option>
            <option value="none">No organisation</option>
            {(tenants.data ?? []).map((t) => (
              <option key={t.tenant_id} value={t.tenant_id}>
                {t.name}
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
          user={editing}
          isSelf={editing !== null && editing.user_id === me?.id}
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
                <th>Organisations</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const isSelf = r.kind === "user" && r.user.user_id === me?.id;
                return (
                  <tr key={r.key}>
                    <td>
                      {r.email}{" "}
                      {r.kind === "user" && r.user.is_platform_admin && <span className="badge accent">super admin</span>}
                    </td>
                    <td className="muted">{r.name ?? "—"}</td>
                    <td className="muted">
                      {r.orgs.length === 0 ? (
                        "—"
                      ) : (
                        <OrgList orgs={r.orgs} />
                      )}
                    </td>
                    <td>
                      <span
                        className={STATUS_BADGE[r.status]}
                        title={
                          r.kind === "invite"
                            ? `Expires ${new Date(r.invite.expires_at).toLocaleDateString()}`
                            : r.user.suspended_at
                              ? `Suspended ${new Date(r.user.suspended_at).toLocaleDateString()}`
                              : undefined
                        }
                      >
                        {STATUS_LABEL[r.status]}
                      </span>
                    </td>
                    <td className="actions">
                      {r.kind === "user" && (
                        <>
                          <button className="btn small ghost" disabled={busy === r.key} onClick={() => setEditing(r.user)}>
                            Edit
                          </button>
                          {!isSelf && (
                            <>
                              {" "}
                              {r.status === "active" ? (
                                <button
                                  className="btn small ghost"
                                  disabled={busy === r.key}
                                  onClick={() => {
                                    if (confirm(`Suspend ${r.email}? They will be signed out and unable to sign in until unsuspended.`)) {
                                      void act(r.key, () => suspendUser(r.user.user_id));
                                    }
                                  }}
                                >
                                  Suspend
                                </button>
                              ) : (
                                <button
                                  className="btn small ghost"
                                  disabled={busy === r.key}
                                  onClick={() => void act(r.key, () => unsuspendUser(r.user.user_id))}
                                >
                                  Unsuspend
                                </button>
                              )}{" "}
                              <button
                                className="btn small ghost"
                                disabled={busy === r.key}
                                onClick={() => {
                                  if (
                                    confirm(
                                      `Permanently delete ${r.email}? This removes their sign-in, memberships and account. It cannot be undone.`,
                                    )
                                  ) {
                                    void act(r.key, () => deletePlatformUser(r.user.user_id));
                                  }
                                }}
                              >
                                Delete
                              </button>
                            </>
                          )}
                        </>
                      )}
                      {r.kind === "invite" && (
                        <>
                          <button
                            className="btn small ghost"
                            disabled={busy === r.key}
                            onClick={() => void act(r.key, () => resendInvitation(r.invite.tenant_id, r.invite.invitation_id))}
                          >
                            Resend
                          </button>{" "}
                          <button
                            className="btn small ghost"
                            disabled={busy === r.key}
                            onClick={() => void act(r.key, () => revokeInvitation(r.invite.tenant_id, r.invite.invitation_id))}
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

/** "Acme Ltd (Admin), Beta Co (Member)" with each name linking to the organisation. */
function OrgList({ orgs }: { orgs: OrgLink[] }) {
  return (
    <>
      {orgs.map((o, i) => (
        <span key={`${o.id}:${i}`}>
          {i > 0 && ", "}
          <Link to={`/orgs/${o.id}`}>{o.name}</Link>{" "}
          <span className="muted">
            (<RoleName name={o.role} />
            {o.status !== "active" && o.status !== "pending" ? `, ${o.status}` : ""})
          </span>
        </span>
      ))}
    </>
  );
}

// ── Edit user ──────────────────────────────────────────────────────────────

function EditUserDrawer({
  user,
  isSelf,
  onClose,
  onSaved,
}: {
  user: PlatformUser | null;
  /** You cannot change your own platform role (you could lock yourself out). */
  isSelf: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset the form each time a different user is opened.
  useEffect(() => {
    if (user) {
      setName(user.name ?? "");
      setIsAdmin(user.is_platform_admin);
      setError(null);
    }
  }, [user]);

  if (!user) return null;

  const nameChanged = name.trim() !== (user.name ?? "");
  const adminChanged = !isSelf && isAdmin !== user.is_platform_admin;
  const unchanged = !nameChanged && !adminChanged;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      // Two endpoints, applied in order so a failed promotion still keeps the name edit.
      if (nameChanged) await updatePlatformUser(user.user_id, { name: name.trim() });
      if (adminChanged) await (isAdmin ? promoteUser(user.user_id) : demoteUser(user.user_id));
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
        label="Platform role"
        hint={
          isSelf
            ? "You cannot change your own platform role."
            : "Super admins manage every organisation, user and project on the platform."
        }
      >
        <select
          className="select"
          value={isAdmin ? "admin" : "user"}
          disabled={isSelf}
          onChange={(e) => setIsAdmin(e.target.value === "admin")}
        >
          <option value="user">User</option>
          <option value="admin">Super admin</option>
        </select>
      </Field>
      {error && <div className="status-banner warn">{error}</div>}
    </Drawer>
  );
}

// ── Invite ─────────────────────────────────────────────────────────────────

function InviteButton({ tenants, onInvited }: { tenants: PlatformTenant[]; onInvited: (notice: string) => void }) {
  const { byLayer } = useRoles();
  const [orgId, setOrgId] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("account_member");
  const [open, setOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  // Suspended organisations cannot take new members.
  const active = tenants.filter((t) => t.status === "active");

  const openDrawer = () => {
    setOrgId(active[0]?.tenant_id ?? "");
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
      const orgName = active.find((t) => t.tenant_id === orgId)?.name ?? "the organisation";
      setOpen(false);
      onInvited(created.email_sent ? `Invitation to ${orgName} sent to ${created.email}.` : created.message);
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <button className="btn primary" onClick={openDrawer} disabled={active.length === 0} title={active.length === 0 ? "Create an organisation first" : undefined}>
        Invite user
      </button>
      <Drawer
        open={open}
        title="Invite user"
        description="They will receive an email with a link to join the chosen organisation."
        onClose={() => setOpen(false)}
        onSubmit={submit}
        footer={
          <>
            <button type="button" className="btn ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="btn primary" disabled={sending || !email.trim() || !orgId}>
              {sending ? "Sending…" : "Send invitation"}
            </button>
          </>
        }
      >
        <Field label="Organisation" hint="Which organisation they will join.">
          <select className="select" value={orgId} onChange={(e) => setOrgId(e.target.value)} required>
            {active.map((t) => (
              <option key={t.tenant_id} value={t.tenant_id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
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
