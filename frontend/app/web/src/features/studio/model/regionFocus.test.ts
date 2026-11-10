import { describe, expect, it } from "vitest";
import type { ProjectPageSummary } from "../../project/wireframes/wireframesApi";
import { focusView, inheritsFocus, narrowDocument, regionLinkChoices, regionLinkName } from "./regionFocus";
import { LayoutNode, PageDocument } from "./types";

const region = (id: string, label: string, size: LayoutNode["size"] = { fr: 1 }): LayoutNode =>
  ({ kind: "region", id, label, size }) as LayoutNode;
const doc = (root: LayoutNode): PageDocument => ({ root, regions: {} });
const split = (id: string, children: LayoutNode[]): LayoutNode =>
  ({ kind: "split", id, dir: "row", size: { fr: 1 }, children }) as LayoutNode;

const users = doc(split("s", [region("filters", "Filters", 240), region("list", "List")]));

const summary = (over: Partial<ProjectPageSummary> & { id: string }): ProjectPageSummary => ({
  name: over.id,
  route: null,
  pos: "a",
  placement: null,
  presentation: null,
  version: 1,
  wireframe_id: "w1",
  wireframe_name: "Admin",
  wireframe_status: "active",
  ...over,
});

describe("narrowDocument", () => {
  it("draws only the region, filling the space the page had", () => {
    const narrowed = narrowDocument(users, "filters");
    expect(narrowed?.root).toMatchObject({ kind: "region", id: "filters", size: { fr: 1 } });
    expect(users.root.kind).toBe("split");
  });

  it("is null for a region that is gone, or for a split", () => {
    expect(narrowDocument(users, "nope")).toBeNull();
    expect(narrowDocument(users, "s")).toBeNull();
  });
});

describe("focusView", () => {
  const shell = { pageId: "home", doc: doc(region("content", "Content")), regionId: "content" };

  it("narrows the open page and keeps its shells", () => {
    const view = focusView({ pageId: "users", regionId: "list" }, { id: "users", document: users }, [shell]);
    expect(view.doc.root.id).toBe("list");
    expect(view.host).toEqual([shell]);
  });

  it("narrows an ancestor only while the page below sits in that region", () => {
    const edit = { id: "edit", document: doc(region("e", "Edit")) };
    const inList = [shell, { pageId: "users", doc: users, regionId: "list" }];
    expect(focusView({ pageId: "users", regionId: "list" }, edit, inList).host[1].doc.root.id).toBe("list");
    const inFilters = [shell, { pageId: "users", doc: users, regionId: "filters" }];
    expect(focusView({ pageId: "users", regionId: "list" }, edit, inFilters).host).toBe(inFilters);
  });

  it("changes nothing without a focus, or when the region is gone", () => {
    const page = { id: "users", document: users };
    expect(focusView(null, page, []).doc).toBe(users);
    expect(focusView({ pageId: "users", regionId: "gone" }, page, []).doc).toBe(users);
  });
});

describe("inheritsFocus", () => {
  const pages = [
    summary({ id: "users" }),
    summary({ id: "edit", placement: { page_id: "users", region_id: "list" } }),
    summary({ id: "other" }),
  ];
  const focus = { pageId: "users", regionId: "list" };

  it("keeps the focus for a page placed under the focused one", () => {
    expect(inheritsFocus("edit", focus, pages)).toBe(true);
  });

  it("drops it for the focused page itself and for unrelated pages", () => {
    expect(inheritsFocus("users", focus, pages)).toBe(false);
    expect(inheritsFocus("other", focus, pages)).toBe(false);
    expect(inheritsFocus("edit", null, pages)).toBe(false);
  });
});

describe("regionLinkChoices", () => {
  const two = [{ id: "filters", label: "Filters" }, { id: "list", label: "List" }];
  const pages = [
    summary({ id: "home", name: "Home", regions: [{ id: "nav", label: "Nav" }, { id: "content", label: "Content" }] }),
    summary({ id: "users", name: "Users", pos: "b", placement: { page_id: "home", region_id: "content" }, regions: two }),
    summary({ id: "single", name: "Single", pos: "c", regions: [{ id: "r", label: "Content" }] }),
    summary({ id: "b-home", name: "Home", wireframe_id: "w2", wireframe_name: "Staff", regions: two }),
    summary({ id: "b-rep", name: "Reports", pos: "b", wireframe_id: "w2", wireframe_name: "Staff", regions: two }),
    summary({ id: "old", name: "Old", wireframe_id: "w3", wireframe_name: "Gone", wireframe_status: "archived", regions: two }),
  ];

  it("lists this wireframe's regions first, then other wireframes' under their name", () => {
    const rows = regionLinkChoices(pages, "w1");
    expect(rows.map((r) => r.label)).toEqual([
      "Home ▸ Nav", "Home ▸ Content", "Home ▸ Users ▸ Filters", "Home ▸ Users ▸ List",
      "Reports ▸ Filters", "Reports ▸ List",
    ]);
    expect(rows.map((r) => r.group)).toEqual([undefined, undefined, undefined, undefined, "Staff", undefined]);
  });

  it("names a region link, with the wireframe when it is another one's", () => {
    expect(regionLinkName({ pageId: "users", regionId: "list" }, pages, "w1")).toBe("Home ▸ Users ▸ List");
    expect(regionLinkName({ pageId: "b-rep", regionId: "list" }, pages, "w1")).toBe("Reports ▸ List · Staff");
    expect(regionLinkName({ pageId: "users", regionId: "gone" }, pages, "w1")).toBeNull();
  });
});
