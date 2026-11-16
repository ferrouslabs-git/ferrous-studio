// @vitest-environment jsdom
// The Resources page from data alone: what an admin sees for running, asleep and unhealthy services, for a
// service reached only through CloudFront, and where CloudOps is off. No server and no AWS.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ActionRow, ResourcesResponse, ServiceRow } from "./cloudopsApi";
import { ActionsLog, ResourcesView, RowActions } from "./CloudOpsResourcesPage";

const row = (over: Partial<ServiceRow>): ServiceRow => ({
  service: "ferrous-studio-staging", app: "ferrous-studio", environment: "staging", app_source: "tag",
  state: "running", state_detail: "1 running", desired: 1, running: 1, vcpu: 0.25, memory_gb: 0.5, public_ip: true,
  cost: { per_task: 12.66, now: 12.66, when_running: 12.66 }, urls: ["https://staging.studio.example.com"], reached_via: [],
  autowake: { enabled: true, idle_minutes: null, keep_awake_until: null, follows: null }, production: false, ...over,
});

const data = (rows: ServiceRow[], enabled = true): ResourcesResponse => ({
  enabled,
  resources: enabled
    ? { services: rows, totals: { now: 12.66, when_all_running: 25.32 }, pricing_note: "Estimated from Fargate list prices." }
    : null,
});

const view = (d: ResourcesResponse | null, extra: { loading?: boolean; error?: string | null } = {}) =>
  renderToStaticMarkup(<ResourcesView data={d} loading={false} error={null} onReload={() => {}} {...extra} />);

describe("ResourcesView", () => {
  it("lists each service with its state, size, cost, address and auto-wake", () => {
    const html = view(data([row({}), row({ service: "x-uat", state: "asleep", state_detail: "scaled to zero", cost: { per_task: 12.66, now: 0, when_running: 12.66 } })]));
    expect(html).toContain("ferrous-studio-staging");
    expect(html).toContain("0.25 vCPU · 0.5 GB");
    expect(html).toContain("$12.66/mo");
    expect(html).toContain("$0.00/mo");
    expect(html).toContain("staging.studio.example.com");
    expect(html).toContain("On · sleeps after 60 min idle");
    expect(html).toContain("cloudops-state running");
    expect(html).toContain("cloudops-state asleep");
  });

  it("totals the estimate and counts the states", () => {
    const html = view(data([row({}), row({ service: "b", state: "unhealthy" })]));
    expect(html).toContain("2 services: 1 running, 0 off, 0 starting, 1 unhealthy.");
    expect(html).toContain("$25.32/mo");
  });

  it("flags production and untagged services", () => {
    const html = view(data([row({ service: "hub-prod", production: true }), row({ service: "old", app_source: "name" })]));
    expect(html).toContain("production");
    expect(html).toContain("from the name, not tagged");
  });

  it("says so, instead of leaving a blank, when a service is reached only through CloudFront", () => {
    const html = view(data([row({ urls: [], reached_via: ["a request header rule (X-Origin-Verify)"] })]));
    expect(html).toContain("Reached by a request header rule (X-Origin-Verify)");
  });

  it("is read-only: the page offers a Reload and nothing that changes a service", () => {
    const html = view(data([row({})]));
    expect(html).toContain("Reload");
    for (const word of ["Start", "Stop", "Delete", "Scale"]) expect(html).not.toContain(`>${word}<`);
    expect(html).toContain("cannot start, stop or change anything");
  });

  it("is switched off, with no table, where CloudOps is not enabled", () => {
    const html = view(data([], false));
    expect(html).toContain("switched off in this environment");
    expect(html).not.toContain("<table");
  });

  it("shows an error without a table", () => {
    const html = view(null, { error: "AWS refused the request" });
    expect(html).toContain("AWS refused the request");
    expect(html).not.toContain("<table");
  });
});

// ── Phase 3: the controls and the audit log ─────────────────────────────────────────────────────────────────────


const actions: RowActions = { onStart: vi.fn(), onStop: vi.fn(), onAutoWake: vi.fn() };
const withActions = (rows: ServiceRow[], extra: { notice?: string | null; log?: ActionRow[] | null } = {}) =>
  renderToStaticMarkup(<ResourcesView data={data(rows)} loading={false} error={null} onReload={() => {}} actions={actions} {...extra} />);

describe("ResourcesView with controls", () => {
  it("offers Stop and Auto-wake on a running service and Start on one that is off", () => {
    const html = withActions([row({}), row({ service: "x-uat", state: "asleep" })]);
    expect(html.match(/>Stop</g)).toHaveLength(1);
    expect(html.match(/>Start</g)).toHaveLength(1);
    expect(html.match(/Auto-wake…/g)).toHaveLength(2);
  });

  it("gives a production service no buttons at all and says where to go", () => {
    const html = withActions([row({ service: "ferrous-hub-prod", production: true })]);
    for (const word of [">Start<", ">Stop<", "Auto-wake…"]) expect(html).not.toContain(word);
    expect(html).toContain("Production: change it in the AWS console.");
  });

  it("disables Auto-wake for a worker that follows another service", () => {
    const html = withActions([row({ autowake: { enabled: false, idle_minutes: null, keep_awake_until: null, follows: "fnai-uat" } })]);
    expect(html).toMatch(/<button[^>]*disabled[^>]*title="Follows fnai-uat"[^>]*>Auto-wake…/);
  });

  it("says that changes are recorded, and shows the notice after an action", () => {
    const html = withActions([row({})], { notice: "Stop requested for x." });
    expect(html).toContain("Every change is recorded below.");
    expect(html).toContain("Stop requested for x.");
  });

  it("never shows the table's Actions column without controls", () => {
    expect(view(data([row({})]))).not.toContain("<th>Actions</th>");
  });
});

describe("ActionsLog", () => {
  const entry = (over: Partial<ActionRow>): ActionRow => ({
    id: "1", created_at: "2026-11-16T12:00:00", user_email: "admin@example.com", action: "stop", service: "ferrous-studio-staging",
    params: {}, before: null, after: null, status: "ok", message: null, ...over,
  });

  it("shows who did what to which service and how it went", () => {
    const html = renderToStaticMarkup(<ActionsLog rows={[entry({}), entry({ id: "2", action: "set_autowake", status: "refused", message: "Start the service first." }), entry({ id: "3", status: "error" })]} />);
    expect(html).toContain("admin@example.com");
    expect(html).toContain("Stopped");
    expect(html).toContain("Changed auto-wake");
    expect(html).toContain("cloudops-result ok");
    expect(html).toContain("cloudops-result refused");
    expect(html).toContain("Start the service first.");
    expect(html).toContain("Failed");
  });

  it("says plainly when nothing has been done yet", () => {
    expect(renderToStaticMarkup(<ActionsLog rows={[]} />)).toContain("Nothing has been changed from this panel yet.");
  });
});
