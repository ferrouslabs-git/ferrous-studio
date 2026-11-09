import { describe, expect, it } from "vitest";
import type { PageUsage, ProjectPageSummary } from "../../project/wireframes/wireframesApi";
import { sharedLinkGroups, sharedPageName, shellIdsByWireframe, usageWireframes, withForeignPages } from "./sharedPages";
import { matchingRegionId } from "./tree";
import { LayoutNode } from "./types";

function pg(id: string, wf: string, pos: string, extra: Partial<ProjectPageSummary> = {}): ProjectPageSummary {
  return {
    id, name: id, route: null, pos, placement: null, presentation: null, version: 0,
    wireframe_id: wf, wireframe_name: `WF ${wf}`, wireframe_status: "active", ...extra,
  };
}

const PAGES: ProjectPageSummary[] = [
  pg("homeA", "a", "a0"),
  pg("users", "a", "a1", { placement: { page_id: "homeA", region_id: "content" } }),
  pg("edit", "a", "a2", { placement: { page_id: "users", region_id: "r" } }),
  pg("homeB", "b", "a0"),
  pg("homeC", "c", "a0", { wireframe_status: "archived" }),
  pg("reports", "c", "a1", { wireframe_status: "archived" }),
];

describe("shared pages", () => {
  it("finds each wireframe's shell by pos, not listing order", () => {
    const shells = shellIdsByWireframe([pg("late", "x", "b0"), pg("first", "x", "a0")]);
    expect(shells.get("x")).toBe("first");
  });

  it("offers other wireframes' pages by path, without their shells or archived wireframes", () => {
    const groups = sharedLinkGroups(PAGES, "b");
    expect(groups).toHaveLength(1);
    expect(groups[0].wireframeName).toBe("WF a");
    expect(groups[0].choices.map((c) => c.label)).toEqual(["homeA ▸ users", "homeA ▸ users ▸ edit"]);
  });

  it("never offers the open wireframe's own pages as shared", () => {
    expect(sharedLinkGroups(PAGES, "a").flatMap((g) => g.choices)).toEqual([]);
  });

  it("appends foreign pages after the wireframe's own, without duplicates", () => {
    const own = [PAGES[3]];
    expect(withForeignPages(own, PAGES, "b").map((p) => p.id)).toEqual(["homeB", "homeA", "users", "edit", "homeC", "reports"]);
  });

  it("names a shared page with its wireframe", () => {
    expect(sharedPageName(PAGES[1], PAGES)).toBe("homeA ▸ users · WF a");
  });

  it("summarises usages per wireframe", () => {
    const u = (page: string, wf: string): PageUsage => ({ page_id: page, page_name: page, wireframe_id: wf, wireframe_name: wf });
    expect(usageWireframes([u("Home", "B")])).toBe("B (Home)");
    expect(usageWireframes([u("Home", "B"), u("Home", "C"), u("Nav", "C")])).toBe("B (Home) and C (Home, Nav)");
  });
});

describe("matchingRegionId", () => {
  const shell = (ids: [string, string][]): LayoutNode => ({
    kind: "split", id: "s", dir: "col", size: { fr: 1 },
    children: ids.map(([id, label], i) => ({ kind: "region", id, label, size: i === 1 ? { fr: 1 } : "auto" })),
  }) as unknown as LayoutNode;

  it("lands in the region with the same label", () => {
    const from = shell([["n1", "Nav"], ["c1", "Content"], ["f1", "Footer"]]);
    const to = shell([["n2", "Nav"], ["c2", "Main"], ["f2", "Footer"]]);
    expect(matchingRegionId(from, "f1", to)).toBe("f2");
  });

  it("falls back to the main content region", () => {
    const from = shell([["n1", "Nav"], ["c1", "Content"]]);
    const to = shell([["n2", "Nav"], ["c2", "Main"]]);
    expect(matchingRegionId(from, "c1", to)).toBe("c2");
    expect(matchingRegionId(from, "gone", to)).toBe("c2");
  });
});
