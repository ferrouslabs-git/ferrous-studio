// "Opens in": a link may say WHERE its target opens (`LinkTarget.into`) — a
// region of the composition the link sits in — instead of wherever the
// target page is placed. A detail page's tab can then open a page (or one
// region of a page) that lives elsewhere, another wireframe included, in the
// region under the tabs, with the detail page and its shells still around it.
//
// Nothing about the target changes: like a region focus (model/regionFocus.ts)
// the override is navigation state on the usePageNav trail, applied when the
// ancestor chain is built (useHostChain). It stays while the pages visited
// belong to what was linked, and goes with the first step outside it.
import type { PageSummary } from "../../projects/projectsApi";
import { LayoutNode, LinkTarget, PagePlacement } from "./types";

/** One followed link's "opens in", as the host chain applies it. */
export interface HostOverride {
  /** The linked page: it renders in `to`, whatever its own placement. */
  pageId: string;
  /** Where another wireframe's page was placed at home. Its siblings there
   *  (the pages its own nav switches between) share that outlet, so they open
   *  in `to` as well. Null for one of this wireframe's own pages, whose
   *  siblings are this wireframe's and keep their places. */
  from: PagePlacement | null;
  to: PagePlacement;
}

export const samePlacement = (a: PagePlacement | null, b: PagePlacement | null): boolean =>
  a === b || (!!a && !!b && a.page_id === b.page_id && a.region_id === b.region_id);

export const sameHost = (a: HostOverride | null, b: HostOverride | null): boolean =>
  a === b || (!!a && !!b && a.pageId === b.pageId && samePlacement(a.from, b.from) && samePlacement(a.to, b.to));

/** Whether `override` decides where the page `pageId` (placed at `placement`)
 *  renders. */
export const overrides = (override: HostOverride, pageId: string, placement: PagePlacement | null): boolean =>
  override.pageId === pageId || (!!override.from && samePlacement(override.from, placement));

/** The override following `target` sets up; null when the link names no
 *  region to open in, or one whose page is gone (the link then opens where
 *  its target is placed, as a link without one does). */
export function hostOverrideFor(
  target: LinkTarget,
  pages: readonly PageSummary[],
  isOwn: (pageId: string) => boolean,
): HostOverride | null {
  const { into } = target;
  if (!into || into.pageId === target.pageId) return null;
  const linked = pages.find((p) => p.id === target.pageId);
  if (!linked || linked.presentation || !pages.some((p) => p.id === into.pageId)) return null;
  return {
    pageId: target.pageId,
    from: isOwn(target.pageId) ? null : linked.placement,
    to: { page_id: into.pageId, region_id: into.regionId },
  };
}

/** Whether a plain visit to `pageId` keeps `override`: the linked page, a
 *  page placed under it, or one sharing its home outlet does. */
export function inheritsHost(pageId: string, override: HostOverride | null, pages: readonly PageSummary[]): boolean {
  if (!override) return false;
  const byId = new Map(pages.map((p) => [p.id, p]));
  const seen = new Set<string>();
  let id: string | undefined = pageId;
  for (let depth = 0; id && !seen.has(id) && depth < 8; depth++) {
    const placement: PagePlacement | null = byId.get(id)?.placement ?? null;
    if (overrides(override, id, placement)) return true;
    seen.add(id);
    id = placement?.page_id;
  }
  return false;
}

/** What the link control knows when a link to an existing page is set. */
export interface OpensInContext {
  /** The component holding the linked element ("navbar", "list", …). */
  componentType: string;
  /** The page that component is on, and the region of it the component is in. */
  ownerPageId: string;
  ownerRoot: LayoutNode;
  ownRegionId: string;
  /** The page being linked to. */
  target: PageSummary;
  /** Whether it belongs to another wireframe of the project. */
  shared: boolean;
}

/** Where a freshly set link opens its target when the user has not chosen:
 *  null leaves it where the target is placed ("Default" in the Inspector's
 *  "Opens in"), a placement pre-selects that region.
 *
 *  TODO(elliott): the default policy. `contentRegionFor(ctx.ownerRoot,
 *  ctx.ownRegionId)` (model/tree.ts) is the region a nav bar's new items
 *  already open their pages in. */
export function defaultOpensIn(_ctx: OpensInContext): LinkTarget["into"] | null {
  return null;
}
