// @vitest-environment jsdom
// The Costs page from data alone: what an admin sees before, during and after a refresh, and in an
// environment where CloudOps is off. No server and no AWS.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CostReport, CostsResponse } from "./cloudopsApi";
import { CostsView } from "./CloudOpsCostsPage";
import { monthName, monthOptions } from "./cloudopsFormat";

const totals = (usage: number, credits: number, vat: number) => ({
  usage, credits, before_vat: usage + credits, vat, with_vat: usage + credits + vat, effective: usage + credits,
});

const report: CostReport = {
  generated_at: "2026-11-16T12:00:00+00:00",
  period: { month_start: "2026-11-01", through: "2026-11-16", last_month_start: "2026-10-01" },
  month_to_date: totals(105, -33.29, 11.61),
  last_month: totals(244.75, -244.75, 0),
  forecast: { remaining: 120.5, month_usage: 225.5, basis: "usage before credits and VAT", at_current_pace: { per_day: 6, days: 7, month_usage: 180 } },
  by_service: [{ name: "Amazon Elastic Container Service", amount: 6 }],
  by_app: [{ name: "fnai", amount: 60 }, { name: "untagged", amount: 10 }],
  by_environment: null,
  daily: [{ date: "2026-11-01", amount: 4.5 }],
  daily_previous: [{ date: "2026-10-31", amount: 4 }],
  notes: ["Per-app figures use the Product tag."],
};

const data = (over: Partial<CostsResponse> = {}): CostsResponse => ({
  enabled: true,
  snapshot: { id: "1", created_at: "2026-11-16T12:00:00", created_by: "admin@example.com", report },
  ...over,
});

const view = (d: CostsResponse | null, extra: { loading?: boolean; refreshing?: boolean; error?: string | null } = {}) =>
  renderToStaticMarkup(<CostsView data={d} loading={false} refreshing={false} error={null} onRefresh={() => {}} {...extra} />);

describe("CostsView", () => {
  it("shows the three headline figures with VAT and credits kept apart", () => {
    const html = view(data());
    expect(html).toContain("This month so far");
    expect(html).toContain("Expected by the end of the month");
    expect(html).toContain("Last month");
    expect(html).toContain("-$33.29"); // credits visible, so a covered month never looks free
    expect(html).toContain("$244.75"); // last month's usage, even though credits covered it
    expect(html).toContain("$225.50");
    expect(html).toContain("If spending stays like the last 7 days");
    expect(html).toContain("$180.00");
  });

  it("names untagged spend and the empty environment tag honestly", () => {
    const html = view(data());
    expect(html).toContain("untagged");
    expect(html).toContain("Not available yet."); // by_environment is null
  });

  it("says who refreshed it, and that opening the page does not call AWS", () => {
    const html = view(data());
    expect(html).toContain("by admin@example.com");
    expect(html).toContain("Opening this page does not call AWS");
  });

  it("invites a first refresh when nothing has been saved", () => {
    const html = view(data({ snapshot: null }));
    expect(html).toContain("No report yet.");
    expect(html).toContain("Refresh report");
    expect(html).not.toContain("This month so far");
  });

  it("is switched off, with the button disabled, where CloudOps is not enabled", () => {
    const html = view(data({ enabled: false, snapshot: null }));
    expect(html).toContain("switched off in this environment");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Refresh report/);
  });

  it("disables the button and says so while refreshing", () => {
    const html = view(data(), { refreshing: true });
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Refreshing…/);
  });

  it("shows an error from the server without hiding the old report", () => {
    const html = view(data(), { error: "Cost Explorer refused the request" });
    expect(html).toContain("Cost Explorer refused the request");
    expect(html).toContain("This month so far");
  });
});


describe("picking another month", () => {
  const october: CostReport = {
    ...report,
    period: { month_start: "2026-10-01", through: "2026-10-31", last_month_start: "2026-09-01", complete: true },
    forecast: null,
  };
  const pastData = (): CostsResponse => ({
    enabled: true,
    snapshot: { id: "2", created_at: "2026-11-16T12:00:00", created_by: null, report: october },
  });
  const pick = (d: CostsResponse | null, month: string) =>
    renderToStaticMarkup(<CostsView data={d} loading={false} refreshing={false} error={null} onRefresh={() => {}} month={month} onMonth={() => {}} />);

  it("offers this month and the 11 before it, newest first, and crosses the new year", () => {
    const o = monthOptions(new Date("2026-02-10T00:00:00Z"));
    expect(o).toHaveLength(12);
    expect(o[0]).toEqual({ value: "", label: "February 2026 (this month)" });
    expect(o[1].value).toBe("2026-01");
    expect(o[2]).toEqual({ value: "2025-12", label: "December 2025" });
    expect(o[11].value).toBe("2025-03");
  });

  it("names a month from its first day", () => {
    expect(monthName("2026-10-01")).toBe("October 2026");
  });

  it("shows the picker, with the chosen month selected", () => {
    const html = pick(pastData(), "2026-10");
    expect(html).toContain('aria-label="Month"');
    expect(html).toMatch(/<option value="2026-10" selected/);
  });

  it("titles a finished month by its name and drops the forecast, which a finished month cannot have", () => {
    const html = pick(pastData(), "2026-10");
    expect(html).toContain("October 2026");
    expect(html).toContain("September 2026"); // the comparison card is the month before, not "Last month"
    expect(html).not.toContain("Expected by the end of the month");
    expect(html).not.toContain("This month so far");
  });

  it("keeps the forecast on this month", () => {
    expect(pick(data(), "")).toContain("Expected by the end of the month");
  });

  it("says which month has no report yet instead of a bare 'no report'", () => {
    const html = pick({ enabled: true, snapshot: null }, "2026-10");
    expect(html).toContain("No report for October 2026 yet.");
  });

  it("hides the picker where CloudOps is switched off", () => {
    expect(pick({ enabled: false, snapshot: null }, "")).not.toContain('aria-label="Month"');
  });
});
