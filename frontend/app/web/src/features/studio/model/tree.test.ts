import { describe, expect, it } from "vitest";
import { blankDocument, contentRegionFor, findNode, firstRegionId, regionIds, removeRegion, splitRegion } from "./tree";
import { PageDocument, RegionNode, SplitNode } from "./types";

const labelOf = (doc: PageDocument, id: string) => (findNode(doc.root, id)!.node as RegionNode).label;

describe("splitRegion", () => {
  it("splits the root region into a row, new region on the right", () => {
    const doc = blankDocument();
    const original = firstRegionId(doc.root);
    doc.regions[original].push({ id: "c1", type: "main", label: "Main", pos: "a0" });

    const fresh = splitRegion(doc, original, "right")!;
    expect(fresh).toBeTruthy();
    expect(doc.root.kind).toBe("split");
    const root = doc.root as SplitNode;
    expect(root.dir).toBe("row");
    expect(root.children.map((c) => c.id)).toEqual([original, fresh]);
    // Content stays with the original region; the new one starts empty.
    expect(doc.regions[original]).toHaveLength(1);
    expect(doc.regions[fresh]).toEqual([]);
  });

  it("adds a sibling instead of nesting when the parent splits the same way", () => {
    const doc = blankDocument();
    const a = firstRegionId(doc.root);
    const b = splitRegion(doc, a, "right")!;
    const c = splitRegion(doc, b, "right")!;
    const root = doc.root as SplitNode;
    expect(root.children).toHaveLength(3);
    expect(root.children.map((n) => n.id)).toEqual([a, b, c]);
  });

  it("nests when splitting across the parent's direction", () => {
    const doc = blankDocument();
    const a = firstRegionId(doc.root);
    const b = splitRegion(doc, a, "right")!;
    splitRegion(doc, b, "top");
    const root = doc.root as SplitNode;
    expect(root.dir).toBe("row");
    const nested = root.children[1] as SplitNode;
    expect(nested.kind).toBe("split");
    expect(nested.dir).toBe("col");
    expect(regionIds(doc.root)).toHaveLength(3);
  });

  it("names new regions after their side, numbering repeats", () => {
    const doc = blankDocument();
    const a = firstRegionId(doc.root);
    expect(labelOf(doc, a)).toBe("Content");
    const top = splitRegion(doc, a, "top")!;
    const top2 = splitRegion(doc, a, "top")!;
    const left = splitRegion(doc, a, "left")!;
    expect(labelOf(doc, top)).toBe("Header");
    expect(labelOf(doc, top2)).toBe("Header 2");
    expect(labelOf(doc, left)).toBe("Sidebar");
  });
});

describe("contentRegionFor", () => {
  it("prefers the first fill region after the source in reading order", () => {
    // Header on top, then sidebar (px) + content (fr) side by side.
    const doc = blankDocument();
    const content = firstRegionId(doc.root);
    const header = splitRegion(doc, content, "top")!;
    const sidebar = splitRegion(doc, content, "left")!;
    expect(contentRegionFor(doc.root, header)).toBe(content);
    expect(contentRegionFor(doc.root, sidebar)).toBe(content);
  });

  it("falls back to the regions before it, and to null when alone", () => {
    const doc = blankDocument();
    const content = firstRegionId(doc.root);
    expect(contentRegionFor(doc.root, content)).toBeNull();
    const footer = splitRegion(doc, content, "bottom")!;
    expect(contentRegionFor(doc.root, footer)).toBe(content);
  });
});

describe("removeRegion", () => {
  it("merges components into the neighbour and collapses single-child splits", () => {
    const doc = blankDocument();
    const a = firstRegionId(doc.root);
    const b = splitRegion(doc, a, "right")!;
    doc.regions[b].push({ id: "c1", type: "form", label: "Form", pos: "a0" });
    doc.regions[a].push({ id: "c0", type: "main", label: "Main", pos: "a0" });

    expect(removeRegion(doc, b)).toBe(true);
    // b's component moved into a, after a's own.
    expect(doc.regions[a].map((c) => c.id)).toEqual(["c0", "c1"]);
    expect(doc.regions[b]).toBeUndefined();
    // The row split collapsed back to a single region root.
    expect(doc.root.kind).toBe("region");
    expect(doc.root.id).toBe(a);
  });

  it("refuses to remove the last region", () => {
    const doc = blankDocument();
    expect(removeRegion(doc, firstRegionId(doc.root))).toBe(false);
  });
});

describe("findNode", () => {
  it("reports parent and index", () => {
    const doc = blankDocument();
    const a = firstRegionId(doc.root);
    const b = splitRegion(doc, a, "bottom")!;
    const found = findNode(doc.root, b)!;
    expect(found.parent?.dir).toBe("col");
    expect(found.index).toBe(1);
  });
});
