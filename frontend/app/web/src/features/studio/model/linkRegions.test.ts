import { describe, expect, it } from "vitest";
import { composeRegionOptions, ComposedLevel } from "./linkRegions";
import { LayoutNode, PageDocument } from "./types";

const region = (id: string, label?: string): LayoutNode => ({ kind: "region", id, size: { fr: 1 }, label });
const split = (id: string, children: LayoutNode[]): LayoutNode => ({ kind: "split", id, dir: "col", size: { fr: 1 }, children });
const doc = (root: LayoutNode): PageDocument => ({ root, regions: {} });

// The reported shape: Home (Nav / Content / Content 2 / Footer) hosting a
// child page that is still one bare auto-named region.
const home: ComposedLevel = {
  doc: doc(split("s1", [region("nav", "Nav"), region("content", "Content"), region("content2", "Content 2"), region("footer", "Footer")])),
  pageId: "home",
  name: "Home",
  outletRegionId: "content",
};

describe("composeRegionOptions", () => {
  it("lists a top-level page's own regions in tree order", () => {
    const { options, alias } = composeRegionOptions([{ ...home, outletRegionId: null }]);
    expect(options.map((o) => o.label)).toEqual(["Nav", "Content", "Content 2", "Footer"]);
    expect(options.every((o) => o.pageId === "home" && o.note === undefined)).toBe(true);
    expect(alias).toEqual({});
  });

  it("skips a bare child page's root and aliases it to the outlet row", () => {
    const child: ComposedLevel = { doc: doc(region("child-root", "Nav")), pageId: "overview", name: "Overview", outletRegionId: null };
    const { options, alias } = composeRegionOptions([home, child]);
    expect(options.map((o) => o.label)).toEqual(["Nav", "Content", "Content 2", "Footer"]);
    expect(alias).toEqual({ "child-root": "content" });
  });

  it("slots a split child page's regions after the outlet row, noted with the page name", () => {
    const child: ComposedLevel = {
      doc: doc(split("cs", [region("c-nav", "Nav"), region("c-content", "Content")])),
      pageId: "overview",
      name: "Overview",
      outletRegionId: null,
    };
    const { options } = composeRegionOptions([home, child]);
    expect(options.map((o) => `${o.pageId}:${o.label}`)).toEqual([
      "home:Nav", "home:Content", "overview:Nav", "overview:Content", "home:Content 2", "home:Footer",
    ]);
    expect(options.filter((o) => o.pageId === "overview").every((o) => o.note === "Overview")).toBe(true);
  });

  it("chains aliases through nested bare pages", () => {
    const mid: ComposedLevel = { doc: doc(region("mid-root")), pageId: "mid", name: "Mid", outletRegionId: "mid-root" };
    const leaf: ComposedLevel = { doc: doc(region("leaf-root")), pageId: "leaf", name: "Leaf", outletRegionId: null };
    const { options, alias } = composeRegionOptions([home, mid, leaf]);
    expect(options.map((o) => o.id)).toEqual(["nav", "content", "content2", "footer"]);
    expect(alias).toEqual({ "mid-root": "content", "leaf-root": "content" });
  });
});
