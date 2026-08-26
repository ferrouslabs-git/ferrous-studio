// Organisation management: members and their roles, pending invitations,
// and workspaces with their own members. Workspace membership is where
// viewers are granted -- a space_viewer sees every project in that workspace.
//
// Every write here is also enforced server-side; the `can*` flags only hide
// controls that would fail.
import { FormEvent, useState } from "react";
import { useParams } from "react-router-dom";
import { useSession } from "../../app/session";
import { errorMessage } from "../../core/api";
import {
  createSpace,
  getSpaceMembers,
  getTenantUsers,
  inviteToSpace,
  inviteToTenant,
  LEGACY_TO_ACCOUNT_ROLE,
  LegacyAccountRole,
  listTenantInvitations,
  removeSpaceMember,
  removeTenantUser,
  resendInvitation,
  revokeInvitation,
  UmSpace,
  updateTenantUserRole,
} from "../../core/umApi";
import { useLoad } from "../../core/useLoad";
import { RoleName, useRoles } from "./roleLabels";

export function OrgPage() {
  const { orgId = "" } = useParams();
  const { orgs, user, spaces, refresh } = useSession();
  const org = orgs.find((o) => o.id === orgId);
  const isPlatformAdmin = !!user?.is_platform_admin;

  if (!org && !isPlatformAdmin) {
    return (
      <div className="page">
        <div className="empty">You are not a member of this organisation.</div>
      </div>
    );
  }

  const myRole = org?.role ?? null;
  const canManage = isPlatformAdmin || myRole === "account_owner";
  const canInvite = canManage || myRole === "account_admin";

  return (
    <div className="page stack">
      <div className="page-head">
        <h1>{org?.name ?? "Organisation"}</h1>
        {myRole && (
          <span className="badge accent">
            <RoleName name={myRole} />
          </span>
        )}
      </div>

      <MembersSection orgId={orgId} currentUserId={user?.id ?? ""} canManage={canManage} />
      <InvitationsSection orgId={orgId} canInvite={canInvite} />
      <WorkspacesSection
        orgId={orgId}
        spaces={spaces}
        canCreate={canInvite}
        canManage={canManage}
        canInvite={canInvite}
        onChanged={refresh}
      />
    </div>
  );
}

// ── Members ────────────────────────────────────────────────────────────────

function MembersSection({
  orgId,
  currentUserId,
  canManage,
}: {
  orgId: string;
  currentUserId: string;
  canManage: boolean;
}) {
  const members = useLoad(() => getTenantUsers(orgId), [orgId]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = async (userId: string, fn: () => Promise<unknown>) => {
    setBusy(userId);
    setError(null);
    try {
      await fn();
      await members.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="section">
      <div className="section-head">
        <h2>Members</h2>
        <span className="muted">{members.data?.length ?? 0}</span>
      </div>
      {error && <div className="status-banner warn">{error}</div>}
      {members.loading ? (
        <div className="empty">Loading…</div>
      ) : members.error ? (
        <div className="empty error">{members.error}</div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Name</th>
              <th>Role</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {members.data?.map((m) => {
              const isSelf = m.user_id === currentUserId;
              return (
                <tr key={m.user_id}>
                  <td>{m.email}</td>
                  <td className="muted">{m.name ?? "—"}</td>
                  <td>
                    {canManage && !isSelf ? (
                      <select
                        className="select"
                        value={legacyOf(m.role)}
                        disabled={busy === m.user_id}
                        onChange={(e) =>
                          void act(m.user_id, () =>
                            updateTenantUserRole(orgId, m.user_id, e.target.value as LegacyAccountRole),
                          )
                        }
                      >
                        {(Object.keys(LEGACY_TO_ACCOUNT_ROLE) as LegacyAccountRole[]).map((r) => (
                          <option key={r} value={r}>
                            {LEGACY_TO_ACCOUNT_ROLE[r].replace("account_", "")}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <RoleName name={m.role} />
                    )}
                  </td>
                  <td className="actions">
                    {canManage && !isSelf && (
                      <button
                        className="btn small ghost"
                        disabled={busy === m.user_id}
                        onClick={() => {
                          if (confirm(`Remove ${m.email} from the organisation?`)) {
                            void act(m.user_id, () => removeTenantUser(orgId, m.user_id));
                          }
                        }}
                      >
                        Remove
                      </button>
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

// ── Invitations ────────────────────────────────────────────────────────────

function InvitationsSection({ orgId, canInvite }: { orgId: string; canInvite: boolean }) {
  const invites = useLoad(() => listTenantInvitations(orgId), [orgId]);
  const { byLayer } = useRoles();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("account_member");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSending(true);
    setError(null);
    setNotice(null);
    try {
      const created = await inviteToTenant(orgId, email.trim(), role);
      setNotice(created.email_sent ? `Invitation sent to ${created.email}.` : created.message);
      setEmail("");
      await invites.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  const pending = (invites.data ?? []).filter((i) => i.status === "pending" || i.status === "expired");

  return (
    <section className="section">
      <div className="section-head">
        <h2>Invitations</h2>
        <span className="muted">{pending.length} open</span>
      </div>
      {canInvite && (
        <form className="section-body row" onSubmit={submit}>
          <input
            className="input"
            type="email"
            required
            placeholder="email@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <select className="select" value={role} onChange={(e) => setRole(e.target.value)}>
            {(byLayer.account ?? []).map((r) => (
              <option key={r.name} value={r.name}>
                {r.display_name}
              </option>
            ))}
          </select>
          <button className="btn primary" disabled={sending}>
            Invite
          </button>
        </form>
      )}
      {notice && <div className="status-banner">{notice}</div>}
      {error && <div className="status-banner warn">{error}</div>}
      {pending.length === 0 ? (
        <div className="empty">No open invitations.</div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Expires</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {pending.map((i) => (
              <tr key={i.invitation_id}>
                <td>{i.email}</td>
                <td>
                  <RoleName name={i.role} />
                  {i.target_scope_type === "space" && <span className="badge"> workspace</span>}
                </td>
                <td>
                  <span className={`badge ${i.status === "pending" ? "good" : ""}`}>{i.status}</span>
                </td>
                <td className="muted">{new Date(i.expires_at).toLocaleDateString()}</td>
                <td className="actions">
                  {canInvite && (
                    <>
                      <button
                        className="btn small ghost"
                        onClick={() =>
                          void resendInvitation(orgId, i.invitation_id)
                            .then(() => invites.reload())
                            .catch((err) => setError(errorMessage(err)))
                        }
                      >
                        Resend
                      </button>{" "}
                      <button
                        className="btn small ghost"
                        onClick={() =>
                          void revokeInvitation(orgId, i.invitation_id)
                            .then(() => invites.reload())
                            .catch((err) => setError(errorMessage(err)))
                        }
                      >
                        Revoke
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ── Workspaces ─────────────────────────────────────────────────────────────

function WorkspacesSection({
  orgId,
  spaces,
  canCreate,
  canManage,
  canInvite,
  onChanged,
}: {
  orgId: string;
  spaces: UmSpace[];
  canCreate: boolean;
  canManage: boolean;
  canInvite: boolean;
  onChanged: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(spaces[0]?.id ?? null);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await createSpace(orgId, name.trim());
      setName("");
      await onChanged();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <section className="section">
      <div className="section-head">
        <h2>Workspaces</h2>
        <span className="muted">{spaces.length}</span>
      </div>
      {canCreate && (
        <form className="section-body row" onSubmit={create}>
          <input
            className="input"
            required
            placeholder="New workspace name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button className="btn primary">Create workspace</button>
        </form>
      )}
      {error && <div className="status-banner warn">{error}</div>}
      {spaces.map((s) => (
        <div key={s.id}>
          <div className="section-head">
            <button className="btn small ghost" onClick={() => setOpen(open === s.id ? null : s.id)}>
              {open === s.id ? "▾" : "▸"} {s.name}
            </button>
            {s.status !== "active" && <span className="badge">{s.status}</span>}
          </div>
          {open === s.id && (
            <WorkspaceMembers orgId={orgId} space={s} canManage={canManage} canInvite={canInvite} />
          )}
        </div>
      ))}
    </section>
  );
}

function WorkspaceMembers({
  orgId,
  space,
  canManage,
  canInvite,
}: {
  orgId: string;
  space: UmSpace;
  canManage: boolean;
  canInvite: boolean;
}) {
  const members = useLoad(() => getSpaceMembers(orgId, space.id), [orgId, space.id]);
  const { byLayer } = useRoles();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("space_viewer");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const invite = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      const created = await inviteToSpace(orgId, space.id, email.trim(), role);
      setNotice(created.email_sent ? `Invitation sent to ${created.email}.` : created.message);
      setEmail("");
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <div className="section-body stack">
      {canInvite && (
        <form className="row" onSubmit={invite}>
          <input
            className="input"
            type="email"
            required
            placeholder="Invite to this workspace"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <select className="select" value={role} onChange={(e) => setRole(e.target.value)}>
            {(byLayer.space ?? []).map((r) => (
              <option key={r.name} value={r.name}>
                {r.display_name}
              </option>
            ))}
          </select>
          <button className="btn">Invite</button>
        </form>
      )}
      {notice && <div className="status-banner">{notice}</div>}
      {error && <div className="status-banner warn">{error}</div>}
      {members.loading ? (
        <div className="muted">Loading…</div>
      ) : members.error ? (
        <div className="error">{members.error}</div>
      ) : members.data?.length === 0 ? (
        <div className="muted">No direct members. Organisation owners and admins have access by inheritance.</div>
      ) : (
        <table className="data-table">
          <tbody>
            {members.data?.map((m) => (
              <tr key={m.user_id}>
                <td>{m.email}</td>
                <td>
                  <RoleName name={m.role} />
                </td>
                <td className="actions">
                  {canManage && (
                    <button
                      className="btn small ghost"
                      onClick={() => {
                        if (confirm(`Remove ${m.email} from ${space.name}?`)) {
                          void removeSpaceMember(orgId, space.id, m.user_id)
                            .then(() => members.reload())
                            .catch((err) => setError(errorMessage(err)));
                        }
                      }}
                    >
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
