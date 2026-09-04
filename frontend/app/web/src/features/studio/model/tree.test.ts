import { describe, expect, it } from "vitest";
import {
  blankDocument,
  fallbackRegionId,
  fixedWidthDemand,
  nodePath,
  regionDisplayName,
  regionIds,
  setRegionDir,
  SHELL_REGION_LABEL,
  splitRegion,
} from "./tree";
import { ComponentNode, LayoutNode, PageDocument, RegionNode } from "./types";

const region = (id: string, size: LayoutNode["size"], label?: string): LayoutNode => ({ kind: "region", id, size, label });

describe("fallbackRegionId", () => {
  it("picks the first fill-sized region, not fixed side columns", () => {
    // A typical shell: sidebar | (header / content) | panel — the content
    // region is the only fill-sized one and must win over the sidebar that
    // precedes it in reading order.
    const root: LayoutNode = {
      kind: "split",
      id: "s1",
      dir: "row",
      size: { fr: 1 },
      children: [
        region("sidebar", 280, "Sidebar"),
        {
          kind: "split",
          id: "s2",
          dir: "col",
          size: 1234,
          children: [region("header", 61, "Header"), region("content", { fr: 1 }, "Content")],
        },
        region("panel", 280, "Panel"),
      ],
    };
    expect(fallbackRegionId(root)).toBe("content");
  });

  it("falls back to the first region when none is fill-sized", () => {
    const root: LayoutNode = {
      kind: "split",
      id: "s1",
      dir: "col",
      size: { fr: 1 },
      children: [region("a", "auto"), region("b", 120)],
    };
    expect(fallbackRegionId(root)).toBe("a");
  });

  it("returns a single region's own id", () => {
    expect(fallbackRegionId(region("only", { fr: 1 }))).toBe("only");
  });
});

describe("setRegionDir", () => {
  const docWith = (root: LayoutNode): PageDocument => ({ root, regions: {} });

  it("stores row and removes the key for col (the default)", () => {
    const doc = docWith(region("a", { fr: 1 }));
    expect(setRegionDir(doc, "a", "row")).toBe(true);
    expect((doc.root as RegionNode).dir).toBe("row");
    expect(setRegionDir(doc, "a", "col")).toBe(true);
    expect("dir" in (doc.root as RegionNode)).toBe(false);
  });

  it("refuses splits and unknown ids", () => {
    const doc = docWith({ kind: "split", id: "s", dir: "row", size: { fr: 1 }, children: [region("a", { fr: 1 }), region("b", { fr: 1 })] });
    expect(setRegionDir(doc, "s", "row")).toBe(false);
    expect(setRegionDir(doc, "missing", "row")).toBe(false);
  });
});

describe("fixedWidthDemand", () => {
  it("sums fixed columns across a row and ignores flexible ones", () => {
    const root: LayoutNode = {
      kind: "split",
      id: "s1",
      dir: "row",
      size: { fr: 1 },
      children: [region("sidebar", 280), region("content", { fr: 1 }), region("panel", 2000)],
    };
    expect(fixedWidthDemand(root)).toBe(2280);
  });

  it("takes the widest branch of a column and ignores fixed heights", () => {
    const root: LayoutNode = {
      kind: "split",
      id: "s1",
      dir: "col",
      size: { fr: 1 },
      children: [
        region("header", 61), // fixed HEIGHT: no width demand
        { kind: "split", id: "s2", dir: "row", size: { fr: 1 }, children: [region("a", 900), region("b", 700)] },
        { kind: "split", id: "s3", dir: "row", size: { fr: 1 }, children: [region("c", 500), region("d", { fr: 1 })] },
      ],
    };
    expect(fixedWidthDemand(root)).toBe(1600);
  });

  it("a fixed-width split is a hard boundary: its content scrolls inside it", () => {
    const root: LayoutNode = {
      kind: "split",
      id: "s1",
      dir: "row",
      size: { fr: 1 },
      children: [
        { kind: "split", id: "s2", dir: "row", size: 300, children: [region("a", 900), region("b", 900)] },
        region("content", { fr: 1 }),
      ],
    };
    expect(fixedWidthDemand(root)).toBe(300);
  });

  it("folds an outlet's demand into its host region", () => {
    const root: LayoutNode = {
      kind: "split",
      id: "s1",
      dir: "row",
      size: { fr: 1 },
      children: [region("sidebar", 280), region("content", { fr: 1 })],
    };
    expect(fixedWidthDemand(root, { regionId: "content", demand: 1500 })).toBe(1780);
  });

  it("is zero when nothing is fixed", () => {
    expect(fixedWidthDemand(region("only", { fr: 1 }))).toBe(0);
  });

  it("counts a fixed-width component in a flexible column region", () => {
    const cmp = (id: string, w?: number): ComponentNode => ({ id, type: "list", label: "Users", pos: "a0", ...(w ? { props: { w } } : {}) });
    const root: LayoutNode = {
      kind: "split",
      id: "s1",
      dir: "row",
      size: { fr: 1 },
      children: [region("sidebar", 280), region("content", { fr: 1 })],
    };
    const regions = { sidebar: [cmp("c1", 900)], content: [cmp("c2", 500), cmp("c3", 640)] };
    // The sidebar is fixed: it contributes its own width, its component
    // stays inside it. The flexible content region demands its widest
    // component instead of nothing.
    expect(fixedWidthDemand(root, undefined, regions)).toBe(280 + 640);
    // Without the regions map behaviour is unchanged.
    expect(fixedWidthDemand(root)).toBe(280);
  });

  it("ignores component widths in a row region — it scrolls sideways", () => {
    const wide: ComponentNode = { id: "c1", type: "list", label: "Users", pos: "a0", props: { w: 900 } };
    const row: LayoutNode = { ...region("r1", { fr: 1 }), dir: "row" } as LayoutNode;
    expect(fixedWidthDemand(row, undefined, { r1: [wide] })).toBe(0);
  });

  it("a free region demands its furthest-right component edge", () => {
    const cmps: ComponentNode[] = [
      { id: "c1", type: "list", label: "A", pos: "a0", props: { x: 500, y: 10, w: 300 } },
      { id: "c2", type: "list", label: "B", pos: "a1", props: { x: 40, y: 200, w: 200 } },
      { id: "c3", type: "list", label: "C", pos: "a2", props: { x: 900, y: 0 } }, // unsized: no demand
    ];
    const freeRegion: LayoutNode = { ...region("r1", { fr: 1 }), dir: "free" } as LayoutNode;
    expect(fixedWidthDemand(freeRegion, undefined, { r1: cmps })).toBe(800);
  });
});

describe("nodePath", () => {
  it("returns root-to-node inclusive, and null for unknown ids", () => {
    const root: LayoutNode = {
      kind: "split",
      id: "s1",
      dir: "row",
      size: { fr: 1 },
      children: [
        region("sidebar", 280),
        { kind: "split", id: "s2", dir: "col", size: { fr: 1 }, children: [region("header", 61), region("content", { fr: 1 })] },
      ],
    };
    expect(nodePath(root, "content")?.map((n) => n.id)).toEqual(["s1", "s2", "content"]);
    expect(nodePath(root, "s1")?.map((n) => n.id)).toEqual(["s1"]);
    expect(nodePath(root, "missing")).toBeNull();
  });
});

describe("automatic region names", () => {
  const labels = (doc: PageDocument) => regionIds(doc.root).map((id) => regionDisplayName(doc.root, id));

  it("names a shell page Nav / Content / Footer as it is split downwards", () => {
    const doc = blankDocument(SHELL_REGION_LABEL);
    const content = splitRegion(doc, doc.root.id, "bottom")!;
    splitRegion(doc, content, "bottom");
    expect(labels(doc)).toEqual(["Nav", "Content", "Footer"]);
  });

  it("names by side once the page has three regions", () => {
    const doc = blankDocument(SHELL_REGION_LABEL);
    const content = splitRegion(doc, doc.root.id, "bottom")!;
    splitRegion(doc, content, "bottom");
    splitRegion(doc, content, "left");
    expect(labels(doc)).toEqual(["Nav", "Sidebar", "Content", "Footer"]);
  });

  it("uses the side name when the lone region is split backwards", () => {
    // The new region lands ABOVE the root, so it is the header, not content.
    const doc = blankDocument(SHELL_REGION_LABEL);
    splitRegion(doc, doc.root.id, "top");
    expect(labels(doc)).toEqual(["Header", "Nav"]);
  });

  it("keeps a linked page's own root name and calls its split Content", () => {
    const doc = blankDocument("Users > Edit");
    splitRegion(doc, doc.root.id, "bottom");
    expect(labels(doc)).toEqual(["Users > Edit", "Content"]);
  });

  it("suffixes a repeated name rather than colliding", () => {
    const doc = blankDocument(SHELL_REGION_LABEL);
    const content = splitRegion(doc, doc.root.id, "bottom")!;
    splitRegion(doc, content, "bottom");
    splitRegion(doc, content, "bottom");
    expect(labels(doc)).toEqual(["Nav", "Content", "Footer 2", "Footer"]);
  });

  it("defaults a blank page to Content, not Nav", () => {
    const doc = blankDocument();
    expect(regionDisplayName(doc.root, doc.root.id)).toBe("Content");
  });
});
