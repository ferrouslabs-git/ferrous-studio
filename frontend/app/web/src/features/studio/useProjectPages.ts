// Every page of the project, for links that share a page across wireframes:
// the picker lists other wireframes' pages, navigation resolves their ids,
// and the host chain swaps a shared page's home shell for this wireframe's.
import { useMemo } from "react";
import { useLoad } from "../../core/useLoad";
import { listProjectPages, ProjectPageSummary } from "../project/wireframes/wireframesApi";
import { shellIdsByWireframe } from "./model/sharedPages";
import { ShellContext } from "./useHostChain";

export interface ProjectPages {
  /** Every page of the project (empty until loaded). */
  pages: ProjectPageSummary[];
  /** Identity-stable while the listing is unchanged (feeds useHostChain). */
  shells: ShellContext;
  reload(): Promise<void> | void;
}

/** `refreshKey` reloads the listing — pass the wireframe detail, which the
 *  studio reloads after every page create/delete. */
export function useProjectPages(projectId: string, wireframeId: string, refreshKey?: unknown): ProjectPages {
  const load = useLoad(() => listProjectPages(projectId), [projectId, refreshKey]);
  const pages = useMemo(() => load.data ?? [], [load.data]);
  const shells = useMemo<ShellContext>(() => {
    const ids = shellIdsByWireframe(pages);
    return { wireframeId, shellOf: (wid) => ids.get(wid) ?? null };
  }, [pages, wireframeId]);
  return { pages, shells, reload: load.reload };
}
