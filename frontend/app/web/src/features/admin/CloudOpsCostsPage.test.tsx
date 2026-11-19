// @vitest-environment jsdom
// The Costs page from data alone: what an admin sees before, during and after a refresh, and in an
// environment where CloudOps is off. No server and no AWS.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CostReport, CostsResponse } from "./cloudopsApi";
import { CostsView } from "./CloudOpsCostsPage";
import { dailyNow, expectedPay, monthName, monthOptions, serviceName } from "./cloudopsFormat";

const totals = (usage: number, credits: number, vat: number) => ({
  usage, credits, before_vat: usage + credits, vat, with_vat: usage + credits + vat, effective: usage + credits,
});

const report: CostReport = {
  generated_at: "2026-11-19T10:57:00+00:00",
  period: { month_start: "2026-11-01", through: "2026-11-19", last_month_start: "2026-10-01" },
  month_to_date: totals(111.34, -33.29, 15.58),
  last_month: totals(244.75, -244.75, 0),
  forecast: { remaining: 167.34, month_usage: 278.68, basis: "usage before credits and VAT", at_current_pace: { per_day: 5.57, days: 7, month_usage: 172.58 } },
  by_service: [{ name: "Amazon Elastic Container Service", amount: 45.58 }, { name: "Amazon Virtual Private Cloud", amount: 24.11 }],
  by_app: [{ name: "untagged", amount: 105.27 }, { name: "shared", amount: 3.01 }, { name: "fnai", amount: 3.06 }],
  by_environment: null,
  daily: [
    { date: "2026-11-11", amount: 7.08 }, { date: "2026-11-12", amount: 6.14 }, { date: "2026-11-13", amount: 6.14 },
    { date: "2026-11-14", amount: 6.55 }, { date: "2026-11-15", amount: 5.83 }, { date: "2026-11-16", amount: 5.23 },
    { date: "2026-11-17", amount: 4.8 }, { date: "2026-11-18", amount: 4.28 }, { date: "2026-11-19", amount: 0.4 },
  ],
  daily_previous: [{ date: "2026-10-30", amount: 7.8 }, { date: "2026-10-31", amount: 8.0 }],
  daily_credits: [{ date: "2026-11-15", amount: 1.95 }, { date: "2026-11-16", amount: 0.71 }],
  credits_ended: "2026-11-16",
  last_by_service: { "Amazon Elastic Container Service": 76.7 },
  history: [
    { month_start: "2026-11-01", ...totals(111.34, -33.29, 15.58) },
    { month_start: "2026-10-01", ...totals(244.75, -244.75, 0) },
    { month_start: "2026-09-01", ...totals(245.1, -245.1, 0) },
  ],
  free_services: ["AWS Lambda", "Amazon Cognito"],
  lambda: { requests: 3584, gb_seconds: 521.7 },
  notes: [],
};

const data = (over: Partial<CostsResponse> = {}, r: CostReport = report): CostsResponse => ({
  enabled: true,
  snapshot: { id: "1", created_at: "2026-11-19T10:57:00", created_by: "admin@example.com", report: r },
  ...over,
});

const view = (d: CostsResponse | null, extra: { loading?: boolean; refreshing?: boolean; error?: string | null } = {}) =>
  renderToStaticMarkup(<CostsView data={d} loading={false} refreshing={false} error={null} onRefresh={() => {}} {...extra} />);

describe("CostsView", () => {
  it("warns that free credits ran out, and when", () => {
    expect(view(data())).toContain("Free credits ran out on 16 Nov.");
    expect(view(data({}, { ...report, credits_ended: null }))).not.toContain("Free credits ran out");
  });

  it("shows the four key figures, credits kept apart so a covered month never looks free", () => {
    const html = view(data());
    expect(html).toContain("We pay so far");
    expect(html).toContain("$78.05");
    expect(html).toContain("$111.34 charges − $33.29 credits");
    expect(html).toContain("+ $15.58 VAT, reclaimed");
    expect(html).toContain("Expected for November");
    expect(html).toContain("$139.29");
    expect(html).toContain("AWS&#x27;s own forecast: $278.68 in charges.");
    expect(html).toContain("Daily spend now");
    expect(html).toContain("$4.28");
    expect(html).toContain("Last month");
    expect(html).toContain("credits covered $244.75");
  });

  it("charts each day as what we pay over what credits covered, against last month's average", () => {
    const html = view(data());
    expect(html).toContain("Daily charges, November");
    expect(html).toContain('class="credit"');
    expect(html).toContain('class="pay"');
    expect(html).toContain("Oct avg $7.90/day");
  });

  it("breaks spend down by service in plain names, with last month alongside", () => {
    const html = view(data());
    expect(html).toContain("Containers (ECS)");
    expect(html).toContain("Network &amp; public IPs (VPC)");
    expect(html).toContain("$76.70");
  });

  it("lists the services that cost nothing, with Lambda's runs", () => {
    const html = view(data());
    expect(html).toContain("Free this month");
    expect(html).toContain("Lambda (3,584 runs)");
    expect(html).toContain("Amazon Cognito");
  });

  it("shows the last few months side by side", () => {
    const html = view(data());
    expect(html).toContain("Recent months");
    expect(html).toContain("September");
    expect(html).toContain("$245.10");
  });

  it("still shows a report saved before the new figures existed", () => {
    const old: CostReport = { ...report, daily_credits: undefined, credits_ended: undefined, last_by_service: undefined, history: undefined, free_services: undefined, lambda: undefined };
    const html = view(data({}, old));
    expect(html).toContain("$78.05");
    expect(html).not.toContain("Free this month");
    expect(html).not.toContain("Recent months");
  });

  it("says who refreshed it, with no explanatory text", () => {
    const html = view(data());
    expect(html).toContain("· admin@example.com");
    expect(html).not.toContain("Opening this page does not call AWS");
    expect(html).not.toContain("What AWS is charging us");
  });

  it("offers a first refresh when nothing has been saved", () => {
    const html = view(data({ snapshot: null }));
    expect(html).toContain("No report yet.");
    expect(html).toContain(">Refresh<");
    expect(html).not.toContain("We pay so far");
  });

  it("is switched off, with the button disabled, where CloudOps is not enabled", () => {
    const html = view(data({ enabled: false, snapshot: null }));
    expect(html).toContain("switched off in this environment");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Refresh</);
  });

  it("disables the button and says so while refreshing", () => {
    expect(view(data(), { refreshing: true })).toMatch(/<button[^>]*disabled[^>]*>Refreshing…/);
  });

  it("shows an error from the server without hiding the old report", () => {
    const html = view(data(), { error: "Cost Explorer refused the request" });
    expect(html).toContain("Cost Explorer refused the request");
    expect(html).toContain("We pay so far");
  });
});

describe("the figures", () => {
  it("expects to pay the month's charges at the recent pace, less the credits already used", () => {
    expect(expectedPay(report)).toBeCloseTo(139.29, 2);
    expect(expectedPay({ ...report, forecast: null })).toBeNull();
  });

  it("takes the latest complete day, not today's partial one, against a week before", () => {
    const d = dailyNow(report)!;
    expect(d.now).toEqual({ date: "2026-11-18", amount: 4.28 });
    expect(d.then).toEqual({ date: "2026-11-12", amount: 6.14 });
    expect(Math.round(d.change! * 100)).toBe(-30);
  });

  it("names common services plainly and leaves the rest as AWS names them", () => {
    expect(serviceName("Amazon Elastic Container Service")).toBe("Containers (ECS)");
    expect(serviceName("AWS Glue")).toBe("AWS Glue");
  });
});

describe("picking another month", () => {
  const october: CostReport = {
    ...report,
    period: { month_start: "2026-10-01", through: "2026-10-31", last_month_start: "2026-09-01", complete: true },
    forecast: null,
    credits_ended: null,
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

  it("shows a finished month as paid, with no forecast and the month before by name", () => {
    const html = pick(pastData(), "2026-10");
    expect(html).toContain("We paid");
    expect(html).toContain("Daily average");
    expect(html).toContain("September 2026");
    expect(html).not.toContain("Expected for");
    expect(html).not.toContain("We pay so far");
  });

  it("keeps the forecast on this month", () => {
    expect(pick(data(), "")).toContain("Expected for November");
  });

  it("says which month has no report yet instead of a bare 'no report'", () => {
    expect(pick({ enabled: true, snapshot: null }, "2026-10")).toContain("No report for October 2026 yet.");
  });

  it("says it is fetching, not 'no report', while a newly picked month is being fetched", () => {
    const html = renderToStaticMarkup(
      <CostsView data={{ enabled: true, snapshot: null }} loading={false} refreshing={true} error={null} onRefresh={() => {}} month="2026-10" onMonth={() => {}} />,
    );
    expect(html).toContain("Fetching the AWS bill…");
    expect(html).not.toContain("No report for");
  });

  it("hides the picker where CloudOps is switched off", () => {
    expect(pick({ enabled: false, snapshot: null }, "")).not.toContain('aria-label="Month"');
  });
});
