// Pages shared across a project's wireframes. A link may target a page of
// any wireframe in the project; nothing in the document marks it as shared —
// a page is "shared" here simply because its home is another wireframe.
import type { PageSummary } from "../../projects/projectsApi";
import type { PageUsage, ProjectPageSummary } from "../../project/wireframes/wireframesApi";

/** Each wireframe's shell: its first page by pos (what the studio lands on
 *  and what child pages are placed in). */
export function shellIdsByWireframe(pages: readonly ProjectPageSummary[]): Map<string, string> {
  const shells = new Map<string, ProjectPageSummary>();
  for (const p of pages) {
    const current = shells.get(p.wireframe_id);
    if (!current || p.pos < current.pos) shells.set(p.wireframe_id, p);
  }
  return new Map([...shells].map(([wid, p]) => [wid, p.id]));
}

/** Pages living in other wireframes, in the order the server lists them
 *  (wireframe order, then page order). */
export function foreignPages(pages: readonly ProjectPageSummary[], wireframeId: string): ProjectPageSummary[] {
  return pages.filter((p) => p.wireframe_id !== wireframeId);
}

/** This wireframe's pages followed by every other wireframe's: what
 *  navigation, landing and back/forward resolve page ids against. */
export function withForeignPages(
  own: readonly PageSummary[],
  pages: readonly ProjectPageSummary[],
  wireframeId: string,
): PageSummary[] {
  const ids = new Set(own.map((p) => p.id));
  return [...own, ...foreignPages(pages, wireframeId).filter((p) => !ids.has(p.id))];
}

/** A placed page named by its path within its own wireframe ("Home ▸ Users"). */
function pathName(page: ProjectPageSummary, byId: Map<string, ProjectPageSummary>): string {
  const names = [page.name];
  const seen = new Set([page.id]);
  let parent = page.placement ? byId.get(page.placement.page_id) : undefined;
  while (parent && !seen.has(parent.id) && names.length < 8) {
    names.unshift(parent.name);
    seen.add(parent.id);
    parent = parent.placement ? byId.get(parent.placement.page_id) : undefined;
  }
  return names.join(" ▸ ");
}

export interface SharedChoice {
  page: ProjectPageSummary;
  /** Path within its own wireframe, e.g. "Home ▸ Users". */
  label: string;
}

export interface SharedGroup {
  wireframeId: string;
  wireframeName: string;
  choices: SharedChoice[];
}

/** What a link may point at in other wireframes, grouped by wireframe.
 *  Archived wireframes are left out (existing links into them keep working),
 *  and so is each wireframe's shell: linking to another wireframe's shell
 *  would swap in that wireframe's whole navigation, which is switching
 *  wireframes, not sharing a page. */
export function sharedLinkGroups(pages: readonly ProjectPageSummary[], wireframeId: string): SharedGroup[] {
  const shells = new Set(shellIdsByWireframe(pages).values());
  const byId = new Map(pages.map((p) => [p.id, p]));
  const groups = new Map<string, SharedGroup>();
  for (const p of foreignPages(pages, wireframeId)) {
    if (p.wireframe_status === "archived" || shells.has(p.id)) continue;
    let group = groups.get(p.wireframe_id);
    if (!group) {
      group = { wireframeId: p.wireframe_id, wireframeName: p.wireframe_name, choices: [] };
      groups.set(p.wireframe_id, group);
    }
    group.choices.push({ page: p, label: pathName(p, byId) });
  }
  return [...groups.values()];
}

/** "Persona B (Home) and Persona C (Home, Settings)" — where a page is used
 *  from other wireframes, for delete warnings. */
export function usageWireframes(usages: readonly PageUsage[]): string {
  const byWireframe = new Map<string, { name: string; pages: string[] }>();
  for (const u of usages) {
    const entry = byWireframe.get(u.wireframe_id) ?? { name: u.wireframe_name, pages: [] };
    if (!entry.pages.includes(u.page_name)) entry.pages.push(u.page_name);
    byWireframe.set(u.wireframe_id, entry);
  }
  const parts = [...byWireframe.values()].map((w) => `${w.name} (${w.pages.join(", ")})`);
  return parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** "Users · Persona A" — how a page from another wireframe is named wherever
 *  the current wireframe's own pages are listed. */
export function sharedPageName(page: ProjectPageSummary, pages: readonly ProjectPageSummary[]): string {
  return `${pathName(page, new Map(pages.map((p) => [p.id, p])))} · ${page.wireframe_name}`;
}
