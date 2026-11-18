// The platform-admin CloudOps > Costs report (INT-REQ-14, phase 1). The server saves each report; opening
// the page reads the latest one and asks AWS nothing, only `refreshCosts` does.
import { apiGet, apiPatch, apiPost } from "../../core/api";

export interface Totals {
  usage: number; // services, before credits and VAT
  credits: number; // negative
  before_vat: number;
  vat: number;
  with_vat: number;
  effective: number; // VAT reclaimed, so equal to before_vat
}

export interface NamedAmount {
  name: string;
  amount: number;
}

export interface DailyAmount {
  date: string;
  amount: number;
}

export interface CostReport {
  generated_at: string;
  period: { month_start: string; through: string; last_month_start: string; complete?: boolean }; // complete: a past month, all of it is in
  month_to_date: Totals;
  last_month: Totals;
  forecast: {
    remaining: number | null; // AWS's own forecast of what is still to come
    month_usage: number | null;
    basis: string;
    at_current_pace?: { per_day: number; days: number; month_usage: number }; // a plain projection, no model
  } | null;
  by_service: NamedAmount[];
  by_app: NamedAmount[] | null;
  by_environment: NamedAmount[] | null;
  daily: DailyAmount[];
  daily_previous: DailyAmount[];
  notes: string[];
}

export interface CostSnapshot {
  id: string;
  created_at: string;
  created_by: string | null;
  report: CostReport;
}

export interface CostsResponse {
  enabled: boolean;
  snapshot: CostSnapshot | null;
}

const BASE = "/studio/admin/cloudops/costs";

// `month` is "YYYY-MM"; left out, the server means this month.
const withMonth = (path: string, month?: string) => (month ? `${path}?month=${encodeURIComponent(month)}` : path);
export const getCosts = (month?: string) => apiGet<CostsResponse>(withMonth(BASE, month), { scope: null });
export const refreshCosts = (month?: string) => apiPost<CostsResponse>(withMonth(`${BASE}/refresh`, month), {}, { scope: null });

// ── Resources (phase 2, read-only) ──────────────────────────────────────────

export type ServiceState = "running" | "asleep" | "stopped" | "starting" | "unhealthy";

export interface AutoWake {
  enabled: boolean;
  idle_minutes: number | null;
  keep_awake_until: string | null;
  follows: string | null;
}

export interface ServiceRow {
  service: string;
  app: string;
  environment: string;
  app_source: "tag" | "name";
  state: ServiceState;
  state_detail: string;
  desired: number;
  running: number;
  vcpu: number;
  memory_gb: number;
  public_ip: boolean;
  cost: { per_task: number; now: number; when_running: number };
  urls: string[];
  reached_via: string[];
  autowake: AutoWake;
  production: boolean;
  /** The service Studio itself runs as: never changed from here, or Studio would switch itself off. */
  protected?: boolean;
}

export interface ResourcesReport {
  services: ServiceRow[];
  totals: { now: number; when_all_running: number };
  pricing_note: string;
}

export interface ResourcesResponse {
  enabled: boolean;
  resources: ResourcesReport | null;
}

export const getResources = () => apiGet<ResourcesResponse>("/studio/admin/cloudops/resources", { scope: null });

// ── Actions (phase 3): every change goes through the guarded control function and is audited ──────────

export interface ActionResult {
  ok: boolean;
  action: string;
  service: string;
  changed: boolean;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

export interface ActionRow {
  id: string;
  created_at: string;
  user_email: string;
  action: string;
  service: string;
  params: Record<string, unknown>;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  status: "ok" | "refused" | "error";
  message: string | null;
}

const RES = "/studio/admin/cloudops/resources";
const svc = (service: string) => `${RES}/${encodeURIComponent(service)}`;

export const startService = (service: string) => apiPost<ActionResult>(`${svc(service)}/start`, {}, { scope: null });
export const stopService = (service: string) => apiPost<ActionResult>(`${svc(service)}/stop`, {}, { scope: null });
export const setAutowake = (service: string, enabled: boolean, idleMinutes: number | null) =>
  apiPatch<ActionResult>(`${svc(service)}/autowake`, { enabled, idle_minutes: idleMinutes }, { scope: null });
export const setKeepAwake = (service: string, until: string | null) =>
  apiPatch<ActionResult>(`${svc(service)}/keep-awake`, { until }, { scope: null });
export const listActions = (limit = 20) => apiGet<ActionRow[]>(`/studio/admin/cloudops/actions?limit=${limit}`, { scope: null });
