// The platform-admin CloudOps > Costs report (INT-REQ-14, phase 1). The server saves each report; opening
// the page reads the latest one and asks AWS nothing, only `refreshCosts` does.
import { apiGet, apiPost } from "../../core/api";

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
  period: { month_start: string; through: string; last_month_start: string };
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

export const getCosts = () => apiGet<CostsResponse>(BASE, { scope: null });
export const refreshCosts = () => apiPost<CostsResponse>(`${BASE}/refresh`, {}, { scope: null });
