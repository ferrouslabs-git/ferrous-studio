// Client for an organisation's audit log (backend
// app/auth/api/tenant_user_routes.py::list_org_audit_events). Keyset-paged,
// newest first.
import { apiGet } from "../../core/api";

export interface OrgAuditActor {
  id: string;
  name: string | null;
  email: string | null;
}

export interface OrgAuditEvent {
  id: string;
  action: string;
  /** Null for an event with no actor (a platform action against the
   *  organisation), or when the acting user has since been hard-deleted. */
  actor: OrgAuditActor | null;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown>;
  timestamp: string;
}

export interface OrgAuditPageResult {
  events: OrgAuditEvent[];
  has_more: boolean;
  next_before: string | null;
}

export const listOrgAudit = (tenantId: string, opts?: { limit?: number; before?: string; action?: string }) => {
  const params = new URLSearchParams();
  if (opts?.limit) params.set("limit", String(opts.limit));
  if (opts?.before) params.set("before", opts.before);
  if (opts?.action) params.set("action", opts.action);
  const query = params.toString();
  return apiGet<OrgAuditPageResult>(`/um/tenants/${tenantId}/audit-events${query ? `?${query}` : ""}`);
};
