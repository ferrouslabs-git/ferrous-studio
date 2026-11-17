// Region links: a link may open ONE region of an existing page instead of
// the whole page (`LinkTarget.regionId`). Nothing is copied — the region is
// shown from the page that owns it, so an edit there shows everywhere the
// region is linked, the same way a shared page does.
//
// Following such a link opens the page "focused" on that region: the page's
// ancestors (and, for another wireframe's page, this wireframe's shell) stay
// around it exactly as they would for the whole page, and inside them only
// the region is drawn. The focus is navigation state (see usePageNav), never
// part of a document.
import type { ProjectPageSummary } from "../../project/wireframes/wireframesApi";
import type { PageSummary } from "../../projects/projectsApi";
import { pathName, shellIdsByWireframe } from "./sharedPages";
import { findNode } from "./tree";
import { PageDocument } from "./types";

/** The region a page is narrowed to while it is on the canvas. */
export interface RegionFocus {
  pageId: string;
  regionId: string;
}

export const sameFocus = (a: RegionFocus | null, b: RegionFocus | null): boolean =>
  a === b || (!!a && !!b && a.pageId === b.pageId && a.regionId === b.regionId);

/** `doc` drawn as just its region `regionId`, which then fills whatever the
 *  page was given (its size was relative to siblings no longer drawn). Null
 *  when the region is gone. Component lists are untouched: ids still resolve
 *  against the full document. */
export function narrowDocument(doc: PageDocument, regionId: string): PageDocument | null {
  const found = findNode(doc.root, regionId);
  if (!found || found.node.kind !== "region") return null;
  return { ...doc, root: { ...found.node, size: { fr: 1 } } };
}

/** One ancestor shell on the canvas (Canvas.HostLevel, structurally). */
interface Level {
  pageId: string;
  doc: PageDocument;
  regionId: string;
}

/** What the canvas draws under `focus`: the focused page narrowed to its
 *  region, whether it is the open page or an ancestor of it. An ancestor is
 *  only narrowed while the page below it sits IN that region — otherwise the
 *  open page would have nowhere to render. A focus that does not apply (page
 *  not on the canvas, region deleted) changes nothing. */
export function focusView<L extends Level>(
  focus: RegionFocus | null,
  page: { id: string; document: PageDocument },
  host: L[],
): { doc: PageDocument; host: L[] } {
  const same = { doc: page.document, host };
  if (!focus) return same;
  if (page.id === focus.pageId) {
    const doc = narrowDocument(page.document, focus.regionId);
    return doc ? { doc, host } : same;
  }
  const at = host.findIndex((h) => h.pageId === focus.pageId);
  if (at < 0 || host[at].regionId !== focus.regionId) return same;
  // Only the ancestor narrows: the open page below it is drawn whole.
  const narrowed = narrowDocument(host[at].doc, focus.regionId);
  return narrowed ? { doc: page.document, host: host.map((h, i) => (i === at ? { ...h, doc: narrowed } : h)) } : same;
}

/** Whether a plain visit to `pageId` keeps the current focus: only a page
 *  placed (at any depth) under the focused page does — it opens inside the
 *  focused region's view. Visiting the focused page itself, or anything
 *  outside it, is ordinary navigation and shows whole pages again. */
export function inheritsFocus(pageId: string, focus: RegionFocus | null, pages: readonly PageSummary[]): boolean {
  if (!focus) return false;
  const byId = new Map(pages.map((p) => [p.id, p]));
  const seen = new Set<string>([pageId]);
  let parent = byId.get(pageId)?.placement?.page_id;
  for (let depth = 0; parent && !seen.has(parent) && depth < 8; depth++) {
    if (parent === focus.pageId) return true;
    seen.add(parent);
    parent = byId.get(parent)?.placement?.page_id;
  }
  return false;
}

/** One region a link may open. */
export interface RegionChoice {
  page: ProjectPageSummary;
  regionId: string;
  /** "Home ▸ Users ▸ Filters": the page's path, then the region. */
  label: string;
  /** Heading for the first row of another wireframe's regions. */
  group?: string;
  /** The other wireframe the region lives in; absent for this one's. */
  wireframe?: string;
}

/** Every existing region a link may open: this wireframe's first, then each
 *  other wireframe's under its name. A page that is a single region is left
 *  out — linking to it IS linking to the page, which the Page list offers.
 *  As with shared pages, archived wireframes and other wireframes' shells
 *  are not offered. */
export function regionLinkChoices(pages: readonly ProjectPageSummary[], wireframeId: string): RegionChoice[] {
  const shells = new Set(shellIdsByWireframe(pages).values());
  const byId = new Map(pages.map((p) => [p.id, p]));
  const own: RegionChoice[] = [];
  const shared: RegionChoice[] = [];
  let lastWireframe: string | null = null;
  for (const page of pages) {
    const regions = page.regions ?? [];
    if (regions.length < 2) continue;
    const foreign = page.wireframe_id !== wireframeId;
    if (foreign && (page.wireframe_status === "archived" || shells.has(page.id))) continue;
    const path = pathName(page, byId);
    regions.forEach((r, i) => {
      const row: RegionChoice = { page, regionId: r.id, label: `${path} ▸ ${r.label}` };
      if (!foreign) {
        own.push(row);
        return;
      }
      row.wireframe = page.wireframe_name;
      if (i === 0 && page.wireframe_id !== lastWireframe) row.group = page.wireframe_name;
      shared.push(row);
    });
    if (foreign) lastWireframe = page.wireframe_id;
  }
  return [...own, ...shared];
}

/** "Users ▸ Filters", with the wireframe when it is another one's — what the
 *  link control shows for a region link. Null when the page or region is gone. */
export function regionLinkName(
  target: { pageId: string; regionId: string },
  pages: readonly ProjectPageSummary[],
  wireframeId: string,
): string | null {
  const page = pages.find((p) => p.id === target.pageId);
  const region = page?.regions?.find((r) => r.id === target.regionId);
  if (!page || !region) return null;
  const name = `${pathName(page, new Map(pages.map((p) => [p.id, p])))} ▸ ${region.label}`;
  return page.wireframe_id === wireframeId ? name : `${name} · ${page.wireframe_name}`;
}
