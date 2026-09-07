// Super admin: every user on the platform in one list, alongside people who
// have been invited to an organisation but not yet joined. Mirrors the
// organisation Users page (features/orgs/OrgPage.tsx) but spans every
// organisation: filters by organisation rather than role, and the invite
// form picks which organisation to invite into -- or none, for a super
// admin, who is a flag on the user rather than a member of anywhere.
//
// Every write here is also enforced server-side (platform admin only).
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useSession } from "../../app/session";
import { Confirmation, ConfirmationDrawer } from "../../components/ConfirmDrawer";
import { Drawer, Field } from "../../components/Drawer";
import { ListTable, NameCell } from "../../components/ListTable";
import { ListToolbar } from "../../components/ListToolbar";
import { RowMenuItem } from "../../components/RowMenu";
import { errorMessage } from "../../core/api";
import { formatDate } from "../../core/format";
import {
  archiveUser,
  deletePlatformUser,
  demoteUser,
  getPlatformInvitations,
  getPlatformTenants,
  getPlatformUsers,
  invitePlatformAdmin,
  inviteToTenant,
  PlatformInvitation,
  PlatformTenant,
  PlatformUser,
  promoteUser,
  resendPlatformInvitation,
  restoreUser,
  revokePlatformInvitation,
  suspendUser,
  unsuspendUser,
  updatePlatformUser,
} from "../../core/umApi";
import { useLoad } from "../../core/useLoad";
import { RoleName, useRoles } from "../orgs/roleLabels";

// ── Rows (users + open invitations) ────────────────────────────────────────

/** A person's standing on the platform, whichever list they came from.
 *  "suspended" is a temporary block on someone who is staying; "archived"
 *  means they have left. Both refuse sign-in, but only an archived user can
 *  be deleted, and only archived rows leave the default view. */
type UserStatus = "active" | "suspended" | "invited" | "expired" | "archived";

/** The status filter: one status, everyone who has not left, or everyone. */
type StatusFilter = "" | "all" | UserStatus;

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
    // Archived wins over suspended: a suspended user who then leaves shows as
    // archived, and Restore brings them back to suspended.
    status: u.archived_at ? "archived" : u.is_active ? "active" : "suspended",
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
      // A super admin invitation leads into no organisation.
      orgs: i.tenant_id ? [{ id: i.tenant_id, name: i.tenant_name ?? i.tenant_id, role: i.role, status: "pending" }] : [],
      invite: i,
    }));
  return [...userRows, ...inviteRows];
}

/** Super admin, whether already one or invited to become one. */
function isSuperAdmin(r: UserRow): boolean {
  return r.kind === "user" ? r.user.is_platform_admin : r.invite.target_scope_type === "platform";
}

const STATUS_LABEL: Record<UserStatus, string> = {
  active: "Active",
  suspended: "Suspended",
  invited: "Invited",
  expired: "Invite expired",
  archived: "Archived",
};
const STATUS_BADGE: Record<UserStatus, string> = {
  active: "badge good",
  suspended: "badge warn",
  invited: "badge accent",
  expired: "badge muted",
  archived: "badge muted",
};

// ── Page ───────────────────────────────────────────────────────────────────

export function AdminUsersPage() {
  const users = useLoad(getPlatformUsers, []);
  const invites = useLoad(getPlatformInvitations, []);
  const tenants = useLoad(getPlatformTenants, []);
  const { user: me } = useSession();
  const { byName } = useRoles();

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<PlatformUser | null>(null);
  const [confirming, setConfirming] = useState<Confirmation | null>(null);

  const [query, setQuery] = useState("");
  const [orgFilter, setOrgFilter] = useState("");
  // Archived users are out of the way by default, as on every other list.
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");

  const rows = useMemo(() => toRows(users.data ?? [], invites.data ?? []), [users.data, invites.data]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (orgFilter === "none" && r.orgs.length > 0) return false;
      if (orgFilter && orgFilter !== "none" && !r.orgs.some((o) => o.id === orgFilter)) return false;
      if (statusFilter === "") {
        if (r.status === "archived") return false;
      } else if (statusFilter !== "all" && r.status !== statusFilter) {
        return false;
      }
      if (!q) return true;
      const haystack = [
        r.email,
        r.name ?? "",
        isSuperAdmin(r) ? "super admin" : "",
        ...r.orgs.flatMap((o) => [o.name, byName[o.role]?.display_name ?? o.role]),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [rows, query, orgFilter, statusFilter, byName]);

  const reload = () => Promise.all([users.reload(), invites.reload(), tenants.reload()]);

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    setNotice(null);
    try {
      await fn();
      await reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  // For a confirmation drawer, which reports a failure itself.
  const confirmed = async (fn: () => Promise<unknown>) => {
    setNotice(null);
    await fn();
    await reload();
  };

  const loading = users.loading || invites.loading;
  const loadError = users.error ?? invites.error;
  const filtered = query.trim() !== "" || orgFilter !== "" || statusFilter !== "";

  const statusDetail = (r: UserRow) =>
    r.kind === "invite"
      ? `Expires ${formatDate(r.invite.expires_at)}`
      : r.user.archived_at
        ? `Archived ${formatDate(r.user.archived_at)}`
        : r.user.suspended_at
          ? `Suspended ${formatDate(r.user.suspended_at)}`
          : undefined;

  const menuItems = (r: UserRow): RowMenuItem[] => {
    if (r.kind === "invite") {
      return [
        {
          label: "Resend invitation",
          onSelect: () => void act(() => resendPlatformInvitation(r.invite.invitation_id)),
        },
        {
          label: "Revoke invitation",
          danger: true,
          onSelect: () => void act(() => revokePlatformInvitation(r.invite.invitation_id)),
        },
      ];
    }
    // An archived user is out of the way: bring them back, or finish the job.
    // Delete lives only here because the server refuses it (409) on anyone
    // who has not been archived first.
    if (r.status === "archived") {
      return [
        { label: "Restore", onSelect: () => void act(() => restoreUser(r.user.user_id)) },
        {
          label: "Delete",
          danger: true,
          onSelect: () =>
            setConfirming({
              title: "Delete user",
              body: (
                <p>
                  Permanently delete <b>{r.email}</b>? This removes their sign-in, memberships and account. It cannot
                  be undone.
                </p>
              ),
              run: () => confirmed(() => deletePlatformUser(r.user.user_id)),
            }),
        },
      ];
    }
    const items: RowMenuItem[] = [{ label: "Edit", onSelect: () => setEditing(r.user) }];
    // Nobody suspends or archives themselves: the account doing it would be gone.
    if (r.user.user_id === me?.id) return items;
    if (r.status === "active") {
      items.push({
        label: "Suspend",
        onSelect: () =>
          setConfirming({
            title: "Suspend user",
            confirmLabel: "Suspend",
            body: (
              <p>
                Suspend <b>{r.email}</b>? They are signed out and cannot sign in until unsuspended.
              </p>
            ),
            run: () => confirmed(() => suspendUser(r.user.user_id)),
          }),
      });
    } else {
      items.push({ label: "Unsuspend", onSelect: () => void act(() => unsuspendUser(r.user.user_id)) });
    }
    items.push({
      label: "Archive",
      onSelect: () =>
        setConfirming({
          title: "Archive user",
          confirmLabel: "Archive",
          body: (
            <p>
              Archive <b>{r.email}</b>? They are signed out and cannot sign in until restored. Their account and
              organisation memberships are kept.
            </p>
          ),
          run: () => confirmed(() => archiveUser(r.user.user_id)),
        }),
    });
    return items;
  };

  return (
    <div className="page stack">
      <div className="page-head">
        <h1>Users</h1>
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

      <ListToolbar
        search={{
          value: query,
          onChange: setQuery,
          placeholder: "Search by email, name, organisation or role",
          label: "Search users",
        }}
        filters={[
          {
            label: "Filter by organisation",
            value: orgFilter,
            onChange: setOrgFilter,
            options: [
              { value: "", label: "All organisations" },
              { value: "none", label: "No organisation" },
              ...(tenants.data ?? []).map((t) => ({ value: t.tenant_id, label: t.name })),
            ],
          },
          {
            label: "Filter by status",
            value: statusFilter,
            onChange: (v) => setStatusFilter(v as StatusFilter),
            options: [
              { value: "", label: "Not archived" },
              ...(Object.keys(STATUS_LABEL) as UserStatus[]).map((s) => ({ value: s, label: STATUS_LABEL[s] })),
              { value: "all", label: "All statuses" },
            ],
          },
        ]}
        count={{ visible: visible.length, total: rows.length, noun: ["user", "users"] }}
      />

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

      <ListTable
        columns={[
          {
            header: "User",
            className: "primary",
            render: (r) => (
              <NameCell sub={r.name ?? undefined} onOpen={r.kind === "user" ? () => setEditing(r.user) : undefined}>
                {r.email}
              </NameCell>
            ),
          },
          {
            header: "Type",
            className: "nowrap",
            render: (r) => (isSuperAdmin(r) ? "Super admin" : <RoleList orgs={r.orgs} />),
          },
          {
            header: "Organisations",
            className: "nowrap",
            render: (r) => <OrgList orgs={r.orgs} />,
          },
          {
            header: "Status",
            render: (r) => (
              <span className={STATUS_BADGE[r.status]} title={statusDetail(r)}>
                {STATUS_LABEL[r.status]}
              </span>
            ),
          },
        ]}
        rows={visible}
        rowKey={(r) => r.key}
        rowLabel={(r) => r.email}
        actions={menuItems}
        loading={loading}
        error={loadError}
        empty={
          filtered ? (
            "No users match these filters."
          ) : (
            <>
              <b>No users yet.</b> Invite someone to an organisation to get started.
            </>
          )
        }
      />

      <ConfirmationDrawer pending={confirming} onClose={() => setConfirming(null)} />
    </div>
  );
}

// The Type and Organisations cells list one line per membership in the same
// order, so a person in several organisations reads across: role beside the
// organisation it is held in.

/** Each organisation on its own line, linking to it. */
function OrgList({ orgs }: { orgs: OrgLink[] }) {
  if (orgs.length === 0) return <span className="muted">—</span>;
  return (
    <>
      {orgs.map((o, i) => (
        <span key={`${o.id}:${i}`} className="line">
          <Link to={`/orgs/${o.id}`}>{o.name}</Link>
        </span>
      ))}
    </>
  );
}

/** The role held in each organisation, one per line; a lapsed membership says so. */
function RoleList({ orgs }: { orgs: OrgLink[] }) {
  if (orgs.length === 0) return <span className="muted">—</span>;
  return (
    <>
      {orgs.map((o, i) => (
        <span key={`${o.id}:${i}`} className="line">
          <RoleName name={o.role} />
          {o.status !== "active" && o.status !== "pending" && <span className="muted"> ({o.status})</span>}
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

/** Role select value for a super admin invitation. Not an organisation
 *  role, so choosing it takes the Organisation field away. */
const SUPER_ADMIN_ROLE = "super_admin";

function InviteButton({ tenants, onInvited }: { tenants: PlatformTenant[]; onInvited: (notice: string) => void }) {
  const { byLayer } = useRoles();
  const [role, setRole] = useState("account_member");
  const [orgId, setOrgId] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  // Suspended organisations cannot take new members.
  const active = tenants.filter((t) => t.status === "active");
  const platform = role === SUPER_ADMIN_ROLE;
  // An organisation role needs somewhere to land; a super admin does not.
  const ready = email.trim() !== "" && (platform || orgId !== "");

  const openDrawer = () => {
    // With nowhere to invite into, the only invitation that can be sent is
    // a super admin one, so start there.
    setRole(active.length === 0 ? SUPER_ADMIN_ROLE : "account_member");
    setOrgId(active[0]?.tenant_id ?? "");
    setEmail("");
    setName("");
    setFormError(null);
    setOpen(true);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSending(true);
    setFormError(null);
    try {
      const created = platform
        ? await invitePlatformAdmin(email.trim(), name.trim())
        : await inviteToTenant(orgId, email.trim(), role, name.trim());
      const where = platform
        ? "as a super admin"
        : `to ${active.find((t) => t.tenant_id === orgId)?.name ?? "the organisation"}`;
      setOpen(false);
      onInvited(created.email_sent ? `Invitation ${where} sent to ${created.email}.` : created.message);
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <button className="btn primary" onClick={openDrawer}>
        Invite user
      </button>
      <Drawer
        open={open}
        title="Invite user"
        description={
          platform
            ? "They will receive an email with a link to set up their super admin account."
            : "They will receive an email with a link to join the chosen organisation."
        }
        onClose={() => setOpen(false)}
        onSubmit={submit}
        footer={
          <>
            <button type="button" className="btn ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="btn primary" disabled={sending || !ready}>
              {sending ? "Sending…" : "Send invitation"}
            </button>
          </>
        }
      >
        <Field
          label="Role"
          hint="Super admins manage the whole platform; admins manage users and invitations; members create and edit projects; viewers have read-only access."
        >
          <select className="select" value={role} onChange={(e) => setRole(e.target.value)}>
            <optgroup label="Platform">
              <option value={SUPER_ADMIN_ROLE}>Super admin</option>
            </optgroup>
            <optgroup label="Organisation">
              {(byLayer.account ?? []).map((r) => (
                <option key={r.name} value={r.name}>
                  {r.display_name}
                </option>
              ))}
            </optgroup>
          </select>
        </Field>
        {!platform && (
          <Field label="Organisation" hint="Which organisation they will join.">
            <select className="select" value={orgId} onChange={(e) => setOrgId(e.target.value)} required>
              {active.length === 0 && <option value="">No active organisations</option>}
              {active.map((t) => (
                <option key={t.tenant_id} value={t.tenant_id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
        )}
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
        {formError && <div className="status-banner warn">{formError}</div>}
      </Drawer>
    </>
  );
}
