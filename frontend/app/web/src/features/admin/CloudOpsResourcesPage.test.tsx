// @vitest-environment jsdom
// The Resources page from data alone: what an admin sees for running, asleep and unhealthy services, for a
// service reached only through CloudFront, and where CloudOps is off. No server and no AWS.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ResourcesResponse, ServiceRow } from "./cloudopsApi";
import { ResourcesView } from "./CloudOpsResourcesPage";

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
