// One sentence per organisation audit event, in British English, stating
// what happened and stopping there -- no explanatory prose (CLAUDE.md).
//
// The known actions are the ones this page can render nicely; also the
// filter's option list (OrgAuditPage.tsx). An action outside this map is not
// invisible -- it renders as its raw name with the metadata alongside -- it
// is just not offered as its own filter.
export const KNOWN_AUDIT_ACTIONS = [
  "github_connected",
  "github_disconnected",
  "invitation_created",
  "invitation_resent",
  "invitation_revoked",
  "invitation_accepted",
  "tenant_user_role_updated",
  "tenant_user_removed",
  "tenant_user_deactivated",
  "tenant_user_reactivated",
  "tenant_updated",
  "tenant_created",
] as const;

/** "account_member" -> "Member". No catalogue lookup (that needs a network
 *  round trip) -- close enough for a one-line audit sentence. */
function roleLabel(role: unknown): string {
  const r = String(role ?? "").replace(/^account_/, "").replace(/_/g, " ");
  return r ? r.charAt(0).toUpperCase() + r.slice(1) : "member";
}

function str(metadata: Record<string, unknown>, key: string): string {
  const v = metadata[key];
  return typeof v === "string" ? v : "";
}

/** One sentence describing `action`, filled from its `metadata`. */
export function describeEvent(action: string, metadata: Record<string, unknown>): string {
  switch (action) {
    case "github_connected": {
      const login = str(metadata, "account_login") || "the account";
      if (metadata.reconnected) return `Reconnected GitHub to ${login}`;
      const selection = metadata.repository_selection === "all" ? "all repositories" : "selected repositories";
      return `Connected GitHub account ${login} (${selection})`;
    }
    case "github_disconnected":
      return `Disconnected GitHub account ${str(metadata, "account_login") || "the account"}`;
    case "invitation_created":
      return `Invited ${str(metadata, "invited_email")} as ${roleLabel(metadata.invited_role)}`;
    case "invitation_resent":
      return `Resent the invitation to ${str(metadata, "invited_email")}`;
    case "invitation_revoked":
      return `Revoked the invitation to ${str(metadata, "invited_email")}`;
    case "invitation_accepted":
      return `Joined as ${roleLabel(metadata.role)}`;
    case "tenant_user_role_updated":
      return `Changed a member's role to ${roleLabel(metadata.new_role)}`;
    case "tenant_user_removed":
      return "Removed a member";
    case "tenant_user_deactivated":
      return "Archived a member";
    case "tenant_user_reactivated":
      return "Restored a member";
    case "tenant_updated": {
      const fields = metadata.updated_fields;
      const name = fields && typeof fields === "object" ? (fields as Record<string, unknown>).name : undefined;
      return typeof name === "string" && name ? `Renamed the organisation to ${name}` : "Updated organisation settings";
    }
    case "tenant_created":
      return "Created the organisation";
    default:
      return action;
  }
}

export const AUDIT_ACTION_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All events" },
  { value: "github_connected", label: "GitHub connected" },
  { value: "github_disconnected", label: "GitHub disconnected" },
  { value: "invitation_created", label: "Invitations sent" },
  { value: "invitation_revoked", label: "Invitations revoked" },
  { value: "invitation_accepted", label: "Invitations accepted" },
  { value: "tenant_user_role_updated", label: "Roles changed" },
  { value: "tenant_user_removed", label: "Members removed" },
  { value: "tenant_updated", label: "Organisation updated" },
];
