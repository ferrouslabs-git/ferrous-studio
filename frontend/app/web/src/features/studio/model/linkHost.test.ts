import { describe, expect, it } from "vitest";
import type { PageSummary } from "../../projects/projectsApi";
import { hostOverrideFor, inheritsHost, overrides } from "./linkHost";

const page = (id: string, placement: PageSummary["placement"] = null, presentation: PageSummary["presentation"] = null): PageSummary => ({
  id,
  name: id,
  route: null,
  pos: "a",
  placement,
  presentation,
  version: 1,
});

// This wireframe: a shell, a detail page in it, a tab page under the detail.
// Another wireframe: its shell, a reporting page in it with two tab pages,
// and a sibling of the reporting page.
const pages = [
  page("shell"),
  page("detail", { page_id: "shell", region_id: "main" }),
  page("packages", { page_id: "detail", region_id: "tabs-body" }),
  page("their-shell"),
  page("reporting", { page_id: "their-shell", region_id: "main" }),
  page("graph", { page_id: "reporting", region_id: "body" }),
  page("leaderboard", { page_id: "their-shell", region_id: "main" }),
  page("dialog", null, "modal"),
];
const own = (id: string) => ["shell", "detail", "packages", "dialog"].includes(id);
const into = { pageId: "detail", regionId: "tabs-body" };

describe("hostOverrideFor", () => {
  it("opens another wireframe's page in the chosen region, remembering its home outlet", () => {
    expect(hostOverrideFor({ pageId: "reporting", into }, pages, own)).toEqual({
      pageId: "reporting",
      from: { page_id: "their-shell", region_id: "main" },
      to: { page_id: "detail", region_id: "tabs-body" },
    });
  });

  it("keeps no home outlet for one of this wireframe's own pages", () => {
    expect(hostOverrideFor({ pageId: "packages", into: { pageId: "shell", regionId: "main" } }, pages, own)?.from).toBeNull();
  });

  it("is null without a region, for an overlay, or when the host page is gone", () => {
    expect(hostOverrideFor({ pageId: "reporting" }, pages, own)).toBeNull();
    expect(hostOverrideFor({ pageId: "dialog", into }, pages, own)).toBeNull();
    expect(hostOverrideFor({ pageId: "reporting", into: { pageId: "gone", regionId: "r" } }, pages, own)).toBeNull();
    expect(hostOverrideFor({ pageId: "detail", into }, pages, own)).toBeNull();
  });
});

describe("inheritsHost", () => {
  const override = hostOverrideFor({ pageId: "reporting", into }, pages, own);

  it("stays for the linked page, pages under it and its home siblings", () => {
    expect(inheritsHost("reporting", override, pages)).toBe(true);
    expect(inheritsHost("graph", override, pages)).toBe(true);
    expect(inheritsHost("leaderboard", override, pages)).toBe(true);
  });

  it("goes with a step back into this wireframe's own pages", () => {
    expect(inheritsHost("packages", override, pages)).toBe(false);
    expect(inheritsHost("detail", override, pages)).toBe(false);
    expect(inheritsHost("packages", null, pages)).toBe(false);
  });

  it("never spreads an own page's override to its siblings", () => {
    const mine = hostOverrideFor({ pageId: "detail", into: { pageId: "packages", regionId: "r" } }, pages, own);
    expect(mine && overrides(mine, "other", { page_id: "shell", region_id: "main" })).toBe(false);
  });
});
