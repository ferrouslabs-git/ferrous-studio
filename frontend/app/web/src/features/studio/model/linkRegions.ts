// The Region list the link menu offers: the visible composition of the open
// page and its ancestor shells, in visual order. An element on a child page
// sits, to the user, "in" the ancestor region the page is placed in — so the
// list spans every document on the canvas, and a placed page that is still a
// single bare region contributes no row of its own (its root is the same
// rectangle as the parent's outlet region) but an alias instead, so "this
// region" resolves to the row the user can actually see.
import { regionDisplayName, regionIds } from "./tree";
import { PageDocument } from "./types";

/** One document on the canvas, outermost shell first, the open page last. */
export interface ComposedLevel {
  doc: PageDocument;
  pageId: string;
  name: string;
  /** Region of `doc` the next level renders in; null for the innermost. */
  outletRegionId: string | null;
}

export interface RegionOption {
  id: string;
  /** The page whose tree holds this region — a page created here is placed
   *  as {page_id, region_id} of THIS page, not the element's. */
  pageId: string;
  label: string;
  /** Owning page's name, shown when the region belongs to a placed page
   *  (inner levels can repeat labels like "Nav"). */
  note?: string;
}

export interface ComposedRegions {
  options: RegionOption[];
  /** Root region of a bare placed page → the id of the listed region that
   *  visually hosts it. */
  alias: Record<string, string>;
}

export function composeRegionOptions(levels: readonly ComposedLevel[]): ComposedRegions {
  const options: RegionOption[] = [];
  const alias: Record<string, string> = {};
  /** The listed region the next level's page fills. */
  let anchor: string | null = null;
  /** Where the next level's rows slot in: right after its outlet's row. */
  let insertAt = 0;

  levels.forEach((level, i) => {
    const ids = regionIds(level.doc.root);
    if (i > 0 && ids.length === 1) {
      // A placed page still one unsplit region fills its outlet exactly; a
      // row for it would duplicate the parent's. Deeper levels keep the same
      // insertion point and anchor.
      if (anchor) alias[ids[0]] = anchor;
      return;
    }
    const rows = ids.map((rid) => ({
      id: rid,
      pageId: level.pageId,
      label: regionDisplayName(level.doc.root, rid),
      note: i > 0 ? level.name : undefined,
    }));
    options.splice(insertAt, 0, ...rows);
    if (level.outletRegionId && ids.includes(level.outletRegionId)) {
      anchor = level.outletRegionId;
      insertAt += ids.indexOf(level.outletRegionId) + 1;
    } else {
      insertAt += rows.length;
    }
  });

  return { options, alias };
}
