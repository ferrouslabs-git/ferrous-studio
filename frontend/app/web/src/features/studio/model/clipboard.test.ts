import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionContext, elKey, LinksProp } from "./actions";
import { PageLike } from "./applyOps";
import { copyComponentItem, copyElementItem, pasteComponent, pasteElement, readClipboard, storeClipboard } from "./clipboard";
import { BACK_PAGE_ID, ComponentNode, ElementNode, LinkTarget, PageDocument } from "./types";

function page(components: ComponentNode[]): PageLike {
  const document: PageDocument = {
    root: { kind: "region", id: "r1", size: { fr: 1 } },
    regions: { r1: components },
  };
  return { name: "Users", route: "/users", pos: "a0", document };
}

const ctx: ActionContext = { customComponents: [] };
const listOf = (p: PageLike, region = "r1") => p.document.regions[region];
const el = (id: string, type: string, label: string, pos: string, data?: Record<string, string>): ElementNode =>
  data ? { id, type, label, pos, data } : { id, type, label, pos };

/** A list with one column whose id is referenced from links and rows. */
const sampleList = (): ComponentNode => ({
  id: "c1",
  type: "list",
  label: "Users",
  pos: "a0",
  elements: [el("e1", "column", "Name", "a0", { kind: "text" })],
  props: {
    rows: [{ e1: "Ada" }, {}],
    links: { "el:e1": { pageId: "p9" }, heading: { pageId: "p2" } },
  },
});

describe("pasteComponent", () => {
  it("remints every id and remaps links and list cells to them", () => {
    const original = sampleList();
    const p = page([original]);
    const item = copyComponentItem(original);
    original.label = "Edited after copy"; // the snapshot must not see this

    const result = pasteComponent(p, ctx, item);
    const pasted = listOf(p)[1];
    expect(result?.selectCmpId).toBe(pasted.id);
    expect(pasted.label).toBe("Users");
    expect(pasted.id).not.toBe("c1");
    const newCol = pasted.elements![0].id;
    expect(newCol).not.toBe("e1");
    const links = pasted.props!.links as LinksProp;
    expect(links[elKey(newCol)]).toEqual({ pageId: "p9" });
    expect(links["el:e1"]).toBeUndefined();
    expect(links.heading).toEqual({ pageId: "p2" }); // scalar keys are not ids
    expect((pasted.props!.rows as Record<string, string>[])[0]).toEqual({ [newCol]: "Ada" });
    // The original is untouched.
    expect(original.id).toBe("c1");
    expect((original.props!.rows as Record<string, string>[])[0]).toEqual({ e1: "Ada" });
  });

  it("pastes the same snapshot repeatedly under fresh ids each time", () => {
    const p = page([sampleList()]);
    const item = copyComponentItem(listOf(p)[0]);
    pasteComponent(p, ctx, item);
    pasteComponent(p, ctx, item);
    const ids = listOf(p).map((c) => c.id);
    expect(new Set(ids).size).toBe(3);
    const colIds = listOf(p).map((c) => c.elements![0].id);
    expect(new Set(colIds).size).toBe(3);
  });

  it("pasting into another wireframe strips page links but keeps @back", () => {
    const original = sampleList();
    (original.props!.links as LinksProp).cancelText = { pageId: BACK_PAGE_ID };
    const p = page([original]);
    const result = pasteComponent(p, ctx, copyComponentItem(original), null, null, { sameWireframe: false });
    expect(result?.toast).toMatch(/another wireframe/);
    const pasted = listOf(p)[1];
    expect(pasted.props!.links).toEqual({ cancelText: { pageId: BACK_PAGE_ID } });
    // The source keeps everything.
    expect(Object.keys(original.props!.links as LinksProp)).toHaveLength(3);
  });

  it("lands in the requested region at the requested index", () => {
    const p = page([sampleList()]);
    p.document.root = {
      kind: "split",
      id: "s1",
      dir: "row",
      size: { fr: 1 },
      children: [
        { kind: "region", id: "r1", size: { fr: 1 } },
        { kind: "region", id: "r2", size: { fr: 1 } },
      ],
    };
    p.document.regions.r2 = [];
    const item = copyComponentItem(listOf(p)[0]);
    pasteComponent(p, ctx, item, "r2", 0);
    expect(listOf(p, "r2")).toHaveLength(1);
    expect(listOf(p)).toHaveLength(1);
  });
});

describe("pasteElement", () => {
  const navbar = (id: string, elements: ElementNode[], links?: Record<string, LinkTarget>): ComponentNode => ({
    id,
    type: "navbar",
    label: "Nav",
    pos: "a0",
    shape: "plain",
    layout: "horizontal",
    elements,
    ...(links ? { props: { links } } : {}),
  });

  it("refuses a type outside the destination's vocabulary", () => {
    const source = navbar("c1", [el("e1", "nav-item", "Home", "a0")]);
    const calendar: ComponentNode = { id: "c2", type: "calendar", label: "Calendar", pos: "a1", shape: "month", elements: [] };
    const p = page([source, calendar]);
    const item = copyElementItem(source, "e1")!;
    const result = pasteElement(p, ctx, "c2", item);
    expect(result?.toast).toMatch(/can't hold/);
    expect(calendar.elements).toHaveLength(0);
  });

  it("honours the destination's max cap", () => {
    const source = navbar("c1", [el("e1", "search", "Search…", "a0")]);
    const dest = navbar("c2", [el("e2", "search", "Find…", "a0")]);
    const p = page([source, dest]);
    const result = pasteElement(p, ctx, "c2", copyElementItem(source, "e1")!);
    expect(result?.toast).toMatch(/already has its search box/);
    expect(dest.elements).toHaveLength(1);
  });

  it("carries the element's link to the destination under its new id", () => {
    const source = navbar("c1", [el("e1", "nav-item", "Home", "a0")], { "el:e1": { pageId: "p7" } });
    const dest = navbar("c2", []);
    const p = page([source, dest]);
    const result = pasteElement(p, ctx, "c2", copyElementItem(source, "e1")!);
    const pasted = dest.elements![0];
    expect(pasted.id).not.toBe("e1");
    expect(result?.selectElement).toEqual({ cmpId: "c2", key: elKey(pasted.id), index: null });
    expect((dest.props!.links as LinksProp)[elKey(pasted.id)]).toEqual({ pageId: "p7" });
  });

  it("carries a column's cells into the destination's rows", () => {
    const source = sampleList();
    source.props!.rows = [{ e1: "Ada" }, { e1: "Grace" }];
    const dest: ComponentNode = { id: "c2", type: "list", label: "People", pos: "a1", shape: "table", elements: [] };
    const p = page([source, dest]);
    pasteElement(p, ctx, "c2", copyElementItem(source, "e1")!);
    const newCol = dest.elements![0].id;
    expect(dest.props!.rows).toEqual([{ [newCol]: "Ada" }, { [newCol]: "Grace" }]);
  });

  it("offsets a canvas child so the copy lands beside the original", () => {
    const canvas: ComponentNode = {
      id: "c1",
      type: "canvas",
      label: "Canvas",
      pos: "a0",
      shape: "plain",
      elements: [el("e1", "button", "Go", "a0", { x: "40", y: "60" })],
    };
    const p = page([canvas]);
    pasteElement(p, ctx, "c1", copyElementItem(canvas, "e1")!);
    const pasted = canvas.elements![1];
    expect(pasted.data).toMatchObject({ x: "56", y: "76" });
  });

  it("pasting into another wireframe drops the element's page link", () => {
    const source = navbar("c1", [el("e1", "nav-item", "Home", "a0")], { "el:e1": { pageId: "p7" } });
    const dest = navbar("c2", []);
    const p = page([source, dest]);
    const result = pasteElement(p, ctx, "c2", copyElementItem(source, "e1")!, { sameWireframe: false });
    expect(result?.toast).toMatch(/another wireframe/);
    expect(dest.elements).toHaveLength(1);
    expect(dest.props?.links).toBeUndefined();
  });

  it("pasting into another wireframe keeps an @back link — it is not a page id", () => {
    const source = navbar("c1", [el("e1", "button", "Cancel", "a0")], { "el:e1": { pageId: BACK_PAGE_ID } });
    const dest = navbar("c2", []);
    const p = page([source, dest]);
    const result = pasteElement(p, ctx, "c2", copyElementItem(source, "e1")!, { sameWireframe: false });
    expect(result?.toast).toBeUndefined();
    expect((dest.props!.links as LinksProp)[elKey(dest.elements![0].id)]).toEqual({ pageId: BACK_PAGE_ID });
  });

  it("clears the header tombstone so migration cannot fight the paste", () => {
    const source: ComponentNode = {
      id: "c1",
      type: "list",
      label: "Users",
      pos: "a0",
      shape: "table",
      elements: [el("e1", "header", "Users", "a0", { placement: "inline" })],
    };
    const dest: ComponentNode = { id: "c2", type: "list", label: "Orders", pos: "a1", shape: "table", elements: [], props: { title: "" } };
    const p = page([source, dest]);
    pasteElement(p, ctx, "c2", copyElementItem(source, "e1")!);
    expect(dest.elements![0].type).toBe("header");
    expect("title" in dest.props!).toBe(false);
  });
});

describe("clipboard storage", () => {
  /** Minimal same-origin store; the module treats it exactly like the real one. */
  const fakeStorage = () => {
    const data = new Map<string, string>();
    return {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    };
  };

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).localStorage;
    vi.resetModules();
  });

  it("returns null when storage holds junk and this tab has copied nothing", async () => {
    const store = fakeStorage();
    (globalThis as Record<string, unknown>).localStorage = store;
    store.setItem("studio.clipboard", '{"v":99,"whatever":true}');
    vi.resetModules();
    const fresh = await import("./clipboard");
    expect(fresh.readClipboard()).toBeNull();
  });

  it("round-trips through storage and survives a corrupt overwrite via the memory copy", () => {
    const store = fakeStorage();
    (globalThis as Record<string, unknown>).localStorage = store;
    const item = copyComponentItem(sampleList());
    storeClipboard(item, { projectId: "proj1", wireframeId: "wf1" });

    const viaStorage = readClipboard();
    expect(viaStorage).toMatchObject({ v: 1, projectId: "proj1", wireframeId: "wf1" });
    expect(viaStorage!.item.label).toBe("Users");

    store.setItem("studio.clipboard", "not json at all");
    const viaMemory = readClipboard();
    expect(viaMemory!.item.label).toBe("Users");
  });

  it("works with no storage at all — the copy still serves this tab", () => {
    const item = copyComponentItem(sampleList());
    storeClipboard(item, { projectId: "proj1", wireframeId: "wf1" });
    expect(readClipboard()!.item.label).toBe("Users");
  });
});
