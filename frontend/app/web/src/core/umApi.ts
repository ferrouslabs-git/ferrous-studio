// Typed client for the auth module (/api/um/*): the logged-in user,
// organisations ("tenants"/"accounts"), members, invitations, role definitions
// and platform administration. Shapes mirror backend/app/auth/schemas/*.py.
//
// User-scoped endpoints send no scope headers; the rest send an explicit
// account scope so they work whatever organisation is currently active.
import { apiDelete, apiGet, apiPatch, apiPost, RequestOptions } from "./api";

const NO_SCOPE: RequestOptions = { scope: null };
const account = (accountId: string): RequestOptions => ({ scope: { type: "account", id: accountId } });

// ── Session basics ──────────────────────────────────────────────────────────

export interface UmMe {
  id: string;
  email: string;
  name: string | null;
  cognito_sub: string;
  is_platform_admin: boolean;
}

/** An organisation the current user belongs to, with their role in it. */
export interface UmTenant {
  id: string;
  name: string;
  status: string;
  role: string;
  created_at: string;
}

export interface RoleDefinition {
  name: string;
  display_name: string;
  layer: "platform" | "account";
}

export interface RoleDefinitions {
  version: string;
  roles: Record<string, RoleDefinition[]>;
}

export const getUmMe = () => apiGet<UmMe>("/um/me", NO_SCOPE);
export const getMyTenants = () => apiGet<UmTenant[]>("/um/tenants/my", NO_SCOPE);
export const getRoleDefinitions = () => apiGet<RoleDefinitions>("/um/config/roles", NO_SCOPE);

export interface TenantCreateResponse {
  tenant_id: string;
  name: string;
  role: string;
  message: string;
}
/** Platform admins only. */
export const createTenant = (name: string) =>
  apiPost<TenantCreateResponse>("/um/tenants", { name }, NO_SCOPE);

/** Organisation admins and platform admins. */
export const updateTenant = (tenantId: string, patch: { name?: string }) =>
  apiPatch<unknown>(`/um/tenants/${tenantId}`, patch, NO_SCOPE);

// ── Organisation members and invitations ───────────────────────────────────

export interface TenantUser {
  user_id: string;
  email: string;
  name: string | null;
  role: string;
  status: string;
  is_active: boolean;
  joined_at: string;
}

/** The role-update endpoint still speaks the legacy vocabulary. */
export type LegacyAccountRole = "admin" | "member" | "viewer";

export const LEGACY_TO_ACCOUNT_ROLE: Record<LegacyAccountRole, string> = {
  admin: "account_admin",
  member: "account_member",
  viewer: "account_viewer",
};

/** `status` defaults server-side to active members; "all" includes archived ("removed") ones. */
export const getTenantUsers = (tenantId: string, status?: "active" | "removed" | "all") =>
  apiGet<TenantUser[]>(`/um/tenants/${tenantId}/users${status ? `?status=${status}` : ""}`, account(tenantId));
/** Archive a membership: the user keeps their account but loses access to this organisation. */
export const deactivateTenantUser = (tenantId: string, userId: string) =>
  apiPatch<unknown>(`/um/tenants/${tenantId}/users/${userId}/deactivate`, {}, account(tenantId));
export const reactivateTenantUser = (tenantId: string, userId: string) =>
  apiPatch<unknown>(`/um/tenants/${tenantId}/users/${userId}/reactivate`, {}, account(tenantId));
/** Edit a member's name and/or role. `name: ""` clears the name. */
export const updateTenantUser = (
  tenantId: string,
  userId: string,
  changes: { name?: string; role?: LegacyAccountRole },
) => apiPatch<unknown>(`/um/tenants/${tenantId}/users/${userId}`, changes, account(tenantId));
export const updateTenantUserRole = (tenantId: string, userId: string, role: LegacyAccountRole) =>
  apiPatch<unknown>(`/um/tenants/${tenantId}/users/${userId}/role`, { role }, account(tenantId));
export const removeTenantUser = (tenantId: string, userId: string) =>
  apiDelete(`/um/tenants/${tenantId}/users/${userId}`, account(tenantId));

export interface TenantInvitation {
  invitation_id: string;
  /** Null for a super admin invitation, which leads into no organisation. */
  tenant_id: string | null;
  email: string;
  /** Display name typed by the inviter, if any. */
  name: string | null;
  role: string;
  status: "pending" | "accepted" | "expired" | "revoked";
  target_scope_type: string | null;
  target_scope_id: string | null;
  /** Who sent it. A member may resend/revoke only their own invitations. */
  created_by: string | null;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
}

export interface InvitationCreated {
  invitation_id: string;
  email: string;
  token: string;
  expires_at: string;
  message: string;
  email_sent: boolean;
  email_detail: string | null;
}

export const listTenantInvitations = (tenantId: string) =>
  apiGet<TenantInvitation[]>(`/um/tenants/${tenantId}/invitations`, account(tenantId));
export const inviteToTenant = (tenantId: string, email: string, targetRoleName: string, name?: string) =>
  apiPost<InvitationCreated>(
    `/um/tenants/${tenantId}/invite`,
    { email, name: name || undefined, role: "member", target_role_name: targetRoleName },
    account(tenantId),
  );
export const revokeInvitation = (tenantId: string, invitationId: string) =>
  apiDelete(`/um/tenants/${tenantId}/invitations/${invitationId}`, account(tenantId));
export const resendInvitation = (tenantId: string, invitationId: string) =>
  apiPost<unknown>(`/um/tenants/${tenantId}/invitations/${invitationId}/resend`, {}, account(tenantId));

// ── Sign-in (the app's own form; backend signs in against Cognito) ─────────

export interface SignInTokens {
  authenticated: boolean;
  access_token: string | null;
  id_token: string | null;
  refresh_token: string | null;
  expires_in: number | null;
}

export const customLogin = (email: string, password: string) =>
  apiPost<SignInTokens>("/um/custom/login", { email, password }, NO_SCOPE);
export const forgotPassword = (email: string) =>
  apiPost<{ sent: boolean; message: string }>("/um/custom/forgot-password", { email }, NO_SCOPE);
export const confirmForgotPassword = (email: string, code: string, newPassword: string) =>
  apiPost<{ confirmed: boolean; message: string }>(
    "/um/custom/confirm-forgot-password",
    { email, code, new_password: newPassword },
    NO_SCOPE,
  );

// ── Invitation acceptance ───────────────────────────────────────────────────

export interface InvitePreview {
  token: string;
  /** Both null for a super admin invitation: there is no organisation to join. */
  tenant_id: string | null;
  tenant_name: string | null;
  email: string;
  name: string | null;
  role: string | null;
  expires_at: string;
  status: "pending" | "accepted" | "expired" | "revoked";
  is_expired: boolean;
  is_accepted: boolean;
  /** "new": no working login yet, show the set-password form. "existing": ask them to sign in. */
  account_state: "new" | "existing";
}

export interface InviteCompleted {
  tenant_id: string | null;
  role: string;
  email: string;
  access_token: string;
  id_token: string;
  refresh_token: string | null;
  expires_in: number;
  message: string;
}

export const getInvitePreview = (token: string) => apiGet<InvitePreview>(`/um/invites/${token}`, NO_SCOPE);
export const acceptInvite = (token: string) =>
  apiPost<{ tenant_id: string | null; role: string; message: string }>("/um/invites/accept", { token }, NO_SCOPE);
/** New-account path: set a password, get signed in and join the organisation in one call. */
export const completeInvite = (token: string, password: string) =>
  apiPost<InviteCompleted>("/um/invites/complete", { token, password }, NO_SCOPE);

// ── Platform administration ─────────────────────────────────────────────────

export interface PlatformTenant {
  tenant_id: string;
  name: string;
  status: string;
  created_at: string;
  member_count: number;
  admin_count: number;
}

export const getPlatformTenants = () => apiGet<PlatformTenant[]>("/um/platform/tenants", NO_SCOPE);
export const suspendTenant = (id: string) => apiPatch<unknown>(`/um/platform/tenants/${id}/suspend`, {}, NO_SCOPE);
export const unsuspendTenant = (id: string) =>
  apiPatch<unknown>(`/um/platform/tenants/${id}/unsuspend`, {}, NO_SCOPE);
export const deletePlatformTenant = (id: string) => apiDelete(`/um/platform/tenants/${id}`, NO_SCOPE);

export interface PlatformUserMembership {
  tenant_id: string | null;
  tenant_name: string | null;
  role: string;
  status: string;
  joined_at: string;
  scope_type: string | null;
  scope_id: string | null;
}

export interface PlatformUser {
  user_id: string;
  email: string;
  name: string | null;
  is_platform_admin: boolean;
  is_active: boolean;
  suspended_at: string | null;
  /** Set once the person has left the platform; they cannot sign in until restored. */
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  memberships: PlatformUserMembership[];
}

export const getPlatformUsers = () => apiGet<PlatformUser[]>("/um/platform/users", NO_SCOPE);
/** Platform admins hold no memberships, so this edits the name directly rather than via an organisation. */
export const updatePlatformUser = (id: string, patch: { name?: string }) =>
  apiPatch<PlatformUser>(`/um/platform/users/${id}`, patch, NO_SCOPE);
/** Reversible: blocks sign-in and hides the user from the default list, keeping the record. */
export const archiveUser = (id: string) => apiPatch<unknown>(`/um/platform/users/${id}/archive`, {}, NO_SCOPE);
export const restoreUser = (id: string) => apiPatch<unknown>(`/um/platform/users/${id}/restore`, {}, NO_SCOPE);
/** Irreversible: removes the Cognito account, memberships and the user record. Only archived users (409 otherwise). */
export const deletePlatformUser = (id: string) => apiDelete(`/um/platform/users/${id}`, NO_SCOPE);

/** An invitation as listed across every organisation. */
export interface PlatformInvitation extends TenantInvitation {
  tenant_name: string | null;
}

export const getPlatformInvitations = () =>
  apiGet<PlatformInvitation[]>("/um/platform/invitations", NO_SCOPE);
/** Invite someone straight in as a super admin: no organisation, no role to choose. */
export const invitePlatformAdmin = (email: string, name?: string) =>
  apiPost<InvitationCreated>("/um/platform/invite", { email, name: name || undefined }, NO_SCOPE);
/** Platform-level resend/revoke: any invitation by ID, including super admin ones, which have no tenant. */
export const resendPlatformInvitation = (invitationId: string) =>
  apiPost<unknown>(`/um/platform/invitations/${invitationId}/resend`, {}, NO_SCOPE);
export const revokePlatformInvitation = (invitationId: string) =>
  apiDelete(`/um/platform/invitations/${invitationId}`, NO_SCOPE);
export const promoteUser = (id: string) => apiPatch<unknown>(`/um/platform/users/${id}/promote`, {}, NO_SCOPE);
export const demoteUser = (id: string) => apiPatch<unknown>(`/um/platform/users/${id}/demote`, {}, NO_SCOPE);
export const suspendUser = (id: string) => apiPatch<unknown>(`/um/users/${id}/suspend`, {}, NO_SCOPE);
export const unsuspendUser = (id: string) => apiPatch<unknown>(`/um/users/${id}/unsuspend`, {}, NO_SCOPE);

export interface AuditEvent {
  id: string;
  timestamp: string;
  actor_user_id: string | null;
  tenant_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata_json: Record<string, unknown>;
}

export const getAuditEvents = (limit = 100) =>
  apiGet<AuditEvent[]>(`/um/platform/audit-events?limit=${limit}`, NO_SCOPE);

// ── Memberships (all scopes) ────────────────────────────────────────────────

export interface UmMembership {
  scope_type: "account";
  scope_id: string;
  role: string;
  status: string;
  tenant_id: string | null;
  tenant_name: string | null;
  joined_at: string;
}

export const getMyMemberships = () => apiGet<UmMembership[]>("/um/me/memberships", NO_SCOPE);
