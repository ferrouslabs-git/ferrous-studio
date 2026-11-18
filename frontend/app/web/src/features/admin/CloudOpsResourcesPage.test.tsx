// @vitest-environment jsdom
// The Resources page from data alone: what an admin sees for running, asleep and unhealthy services, for a
// service reached only through CloudFront, and where CloudOps is off. No server and no AWS.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ActionRow, ResourcesResponse, ServiceRow } from "./cloudopsApi";
import { ActionsLog, DetailsDrawer, ResourcesView, RowActions } from "./CloudOpsResourcesPage";

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

const details = (r: ServiceRow, actions?: RowActions) =>
  renderToStaticMarkup(<DetailsDrawer row={r} onClose={() => {}} actions={actions} />);

describe("ResourcesView", () => {
  it("lists each service as one compact row: name, environment, state and instances", () => {
    const html = view(data([row({}), row({ service: "x-uat", environment: "uat", state: "asleep", running: 0, desired: 0 })]));
    expect(html).toContain("ferrous-studio-staging");
    expect(html).toContain(">staging<");
    expect(html).toContain(">uat<");
    expect(html).toContain("cloudops-state running");
    expect(html).toContain("cloudops-state asleep");
    expect(html).toContain("<b>1</b> / 1");
    expect(html).toContain("Details for x-uat");
  });

  it("keeps size, cost, address and auto-wake out of the row", () => {
    const html = view(data([row({})]));
    expect(html).not.toContain("0.25 vCPU");
    expect(html).not.toContain("staging.studio.example.com");
    expect(html).not.toContain("sleeps after");
  });

  it("counts the states and shows the monthly cost now, with the all-running figure on hover", () => {
    const html = view(data([row({}), row({ service: "b", state: "unhealthy" })]));
    expect(html).toContain("2 services");
    expect(html).toContain("1 running");
    expect(html).toContain("0 off");
    expect(html).toContain("1 unhealthy");
    expect(html).toContain("$12.66/mo");
    expect(html).toContain("If every service were on: $25.32 a month.");
  });

  it("marks production", () => {
    const html = view(data([row({ service: "hub-prod", production: true })]));
    expect(html).toContain('class="cloudops-env prod">production<');
  });

  it("is read-only without actions: a Reload and nothing that changes a service", () => {
    const html = view(data([row({})]));
    expect(html).toContain("Reload");
    expect(html).not.toContain('role="switch"');
    expect(html).not.toContain(">Action<");
  });

  it("is switched off, with no list, where CloudOps is not enabled", () => {
    const html = view(data([], false));
    expect(html).toContain("switched off in this environment");
    expect(html).not.toContain('role="table"');
  });

  it("shows an error without a list", () => {
    const html = view(null, { error: "AWS refused the request" });
    expect(html).toContain("AWS refused the request");
    expect(html).not.toContain('role="table"');
  });
});

describe("DetailsDrawer", () => {
  it("shows size, cost, address and auto-wake for one service", () => {
    const html = details(row({}));
    expect(html).toContain("ferrous-studio / staging");
    expect(html).toContain("0.25 vCPU · 0.5 GB each");
    expect(html).toContain("$12.66/mo");
    expect(html).toContain("staging.studio.example.com");
    expect(html).toContain("On · sleeps after 60 min idle");
  });

  it("flags a service whose app comes from its name, not a tag", () => {
    expect(details(row({ app_source: "name" }))).toContain("from the name, not tagged");
  });

  it("says so, instead of leaving a blank, when a service is reached only through CloudFront", () => {
    const html = details(row({ urls: [], reached_via: ["a request header rule (X-Origin-Verify)"] }));
    expect(html).toContain("Reached by a request header rule (X-Origin-Verify)");
  });

  it("offers Auto-wake for a non-production service, disabled for a worker that follows another", () => {
    expect(details(row({}), actions)).toContain("Auto-wake…");
    const follower = details(row({ autowake: { enabled: false, idle_minutes: null, keep_awake_until: null, follows: "fnai-uat" } }), actions);
    expect(follower).toMatch(/<button[^>]*disabled[^>]*title="Follows fnai-uat"[^>]*>Auto-wake…/);
  });

  it("offers no auto-wake on a production service", () => {
    const html = details(row({ service: "ferrous-hub-prod", production: true }), actions);
    expect(html).not.toContain("Auto-wake…");
    expect(html).not.toContain("AWS console");
  });

  it("says where to go for the service Studio itself runs as", () => {
    const html = details(row({ service: "ferrous-studio-prod", production: true, protected: true }), actions);
    expect(html).toContain("Runs Studio itself: change it in the AWS console.");
  });
});

// ── Phase 3: the controls and the audit log ─────────────────────────────────────────────────────────────────────

const actions: RowActions = { onStart: vi.fn(), onStop: vi.fn(), onAutoWake: vi.fn() };
const withActions = (rows: ServiceRow[], extra: { notice?: string | null; log?: ActionRow[] | null } = {}) =>
  renderToStaticMarkup(<ResourcesView data={data(rows)} loading={false} error={null} onReload={() => {}} actions={actions} {...extra} />);

describe("ResourcesView with controls", () => {
  it("shows the switch on for a running service and off for one that is asleep", () => {
    const html = withActions([row({}), row({ service: "x-uat", state: "asleep" })]);
    expect(html).toMatch(/role="switch" aria-checked="true" aria-label="Stop ferrous-studio-staging"/);
    expect(html).toMatch(/role="switch" aria-checked="false" aria-label="Start x-uat"/);
  });

  it("gives a production service a switch like any other", () => {
    const html = withActions([row({ service: "ferrous-hub-prod", production: true })]);
    expect(html).toMatch(/role="switch" aria-checked="true" aria-label="Stop ferrous-hub-prod"/);
    expect(html).not.toContain("Protected");
  });

  it("gives the service Studio itself runs as a lock instead of a switch", () => {
    const html = withActions([row({ service: "ferrous-studio-prod", production: true, protected: true })]);
    expect(html).not.toContain('role="switch"');
    expect(html).toContain("Protected");
  });

  it("shows the notice after an action", () => {
    const html = withActions([row({})], { notice: "Stop requested for x." });
    expect(html).toContain("Stop requested for x.");
  });

  it("has an Action column only with controls", () => {
    expect(withActions([row({})])).toContain(">Action<");
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
    expect(html).toContain("stopped");
    expect(html).toContain("changed auto-wake");
    expect(html).toContain("cloudops-result ok");
    expect(html).toContain("cloudops-result refused");
    expect(html).toContain("Start the service first.");
    expect(html).toContain("Failed");
  });

  it("says plainly when nothing has been done yet", () => {
    expect(renderToStaticMarkup(<ActionsLog rows={[]} />)).toContain("Nothing has been changed from this panel yet.");
  });
});
