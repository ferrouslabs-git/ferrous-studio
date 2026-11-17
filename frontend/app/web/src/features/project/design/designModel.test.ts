// What the design pages say about a design is derived here, so it is checked
// here: the status badge, what may be framed, and what may become a link out
// to Figma.
import { describe, expect, it } from "vitest";
import type { Wireframe } from "../wireframes/wireframesApi";
import {
  designState,
  designWireframes,
  figmaHref,
  freshSiteUrl,
  interfaceTypesOf,
  publishedSite,
  wireframeSummary,
} from "./designModel";

describe("designState", () => {
  it("moves from not generated, to in Figma, to published", () => {
    expect(designState({ figma_url: null, published_url: null })).toBe("not_generated");
    expect(designState({ figma_url: "https://www.figma.com/make/AbC", published_url: null })).toBe("in_figma");
    expect(designState({ figma_url: "https://www.figma.com/make/AbC", published_url: "https://a.figma.site" })).toBe(
      "published",
    );
  });
  it("does not call a site published that cannot be framed", () => {
    expect(designState({ figma_url: null, published_url: "https://www.figma.com/make/AbC" })).toBe("not_generated");
  });
});

describe("publishedSite", () => {
  it("frames a figma.site subdomain over https", () => {
    expect(publishedSite("https://memory-drums-73248247.figma.site")).toBe("https://memory-drums-73248247.figma.site/");
  });
  it("frames nothing else, matching the CSP's frame-src", () => {
    for (const url of [
      null,
      "",
      "https://figma.site/",
      "http://checkout.figma.site/",
      "https://www.figma.com/make/AbC",
      "https://checkout.figma.site.evil.example/",
      "https://user:pw@checkout.figma.site/",
      "javascript:alert(1)",
    ]) {
      expect(publishedSite(url)).toBeNull();
    }
  });
});

describe("freshSiteUrl", () => {
  it("adds a cache-buster without touching the path or the hash route", () => {
    expect(freshSiteUrl("https://a.figma.site/app#/orders", 42)).toBe("https://a.figma.site/app?studio_sync=42#/orders");
  });
});

describe("figmaHref", () => {
  it("accepts Figma's own https addresses", () => {
    expect(figmaHref("https://www.figma.com/make/AbC/Checkout")).toBe("https://www.figma.com/make/AbC/Checkout");
    expect(figmaHref("https://checkout.figma.site/")).toBe("https://checkout.figma.site/");
  });
  it("refuses anything else, so no other link is ever built from a stored value", () => {
    for (const url of [
      null,
      "",
      "not a url",
      "http://www.figma.com/make/AbC",
      "javascript:alert(1)",
      "https://figma.com.evil.example/make/AbC",
      "https://evilfigma.com/make/AbC",
    ]) {
      expect(figmaHref(url)).toBeNull();
    }
  });
});

const wireframe = (id: string, over: Partial<Wireframe> = {}): Wireframe => ({
  id,
  project_id: "p1",
  name: id.toUpperCase(),
  interface_type: "desktop",
  status: "active",
  pos: "a0",
  landing_page_id: null,
  persona_ids: [],
  actor_ids: [],
  created_at: "2026-11-16T09:00:00",
  updated_at: "2026-11-16T09:00:00",
  ...over,
});

describe("designWireframes", () => {
  const all = [wireframe("a"), wireframe("b", { status: "archived" }), wireframe("c")];

  it("is every active wireframe for all", () => {
    const got = designWireframes({ all_wireframes: true, wireframe_ids: [] }, all);
    expect(got.wireframes.map((w) => w.id)).toEqual(["a", "c"]);
    expect(got.missing).toBe(0);
  });
  it("keeps the picked order, archived included, and counts deleted ones", () => {
    const got = designWireframes({ all_wireframes: false, wireframe_ids: ["c", "gone", "b"] }, all);
    expect(got.wireframes.map((w) => w.id)).toEqual(["c", "b"]);
    expect(got.missing).toBe(1);
  });
});

describe("wireframeSummary", () => {
  const all = [wireframe("a"), wireframe("b"), wireframe("c")];
  const picked = (ids: string[]) => wireframeSummary({ all_wireframes: false, wireframe_ids: ids }, all);

  it("names all, a few, or the first and a count", () => {
    expect(wireframeSummary({ all_wireframes: true, wireframe_ids: [] }, all)).toBe("All wireframes");
    expect(picked(["b"])).toBe("B");
    expect(picked(["b", "a"])).toBe("B, A");
    expect(picked(["c", "a", "b"])).toBe("C and 2 more");
    expect(picked(["gone"])).toBe("Deleted wireframes");
  });
});

describe("interfaceTypesOf", () => {
  it("lists each device once, in wireframe order", () => {
    const types = interfaceTypesOf([
      wireframe("a", { interface_type: "mobile" }),
      wireframe("b"),
      wireframe("c", { interface_type: "mobile" }),
    ]);
    expect(types).toEqual(["mobile", "desktop"]);
  });
});
