// The preview-mode chrome and canvas, shared by the two things that can be
// previewed: a wireframe's live pages and a saved snapshot's. Everything here
// is read-only — no ops are ever sent — and linked elements navigate on a
// single click, with browser-style back/forward over the pages visited.
//
// Where the pages come from is the caller's business (see PageFetcher): the
// live preview fetches them, snapshot preview resolves them from the snapshot
// it loaded. Custom components and datasets are always the project's live
// ones, since those are shared project state a restore would not replace.
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLoad } from "../../core/useLoad";
import { listDatasets } from "../project/datasets/datasetsApi";
import { useProject } from "../project/ProjectLayout";
import { deviceClass, type InterfaceType } from "../project/wireframes/wireframesApi";
import type { PageSummary } from "../projects/projectsApi";
import { deviceMinWidth } from "./components/Canvas";
import { PreviewCanvas } from "./components/PreviewCanvas";
import { CustomDef } from "./model/actions";
import { BACK_PAGE_ID, LinkTarget } from "./model/types";
import { Stage, useStageFit } from "./stage";
import { useHostChain } from "./useHostChain";
import { useNavLanding } from "./useNavLanding";
import { PageFetcher, usePageDocument } from "./usePageDocument";
import { usePageNav } from "./usePageNav";

interface Props {
  interfaceType: InterfaceType;
  /** Every page that can be reached, in pos order. */
  pages: readonly PageSummary[];
  /** The page to open on, before falling back to the shell's first nav link. */
  landingPageId: string | null;
  /** Identity-stable page source (see PageFetcher). */
  fetchPage: PageFetcher;
  /** Top bar, left of the page-nav arrows: the way out, the title, any
   *  switcher the caller wants. */
  chrome: ReactNode;
  /** Strip under the top bar — what is being previewed, and what can be done
   *  with it. */
  banner?: ReactNode;
  /** Empty-state line when the previewed thing has no pages at all. */
  emptyHint?: string;
}

export function PreviewShell({
  interfaceType,
  pages,
  landingPageId,
  fetchPage,
  chrome,
  banner,
  emptyHint = "This wireframe has no pages yet.",
}: Props) {
  const { project } = useProject();
  const datasetsLoad = useLoad(() => listDatasets(project.id), [project.id]);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** The mat, measured to scale a framed device into it (see stage.tsx). */
  const canvasWrap = useRef<HTMLDivElement>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const nav = usePageNav(pages, activePageId, setActivePageId);

  // The open page: the outgoing one stays rendered while the next loads, so
  // clicking through links never blanks the canvas (see usePageDocument).
  const doc = usePageDocument(fetchPage, activePageId, { onError: setNotice });
  const { page, pendingPageId } = doc;

  // Land on the pinned landing page, else where the shell's nav points
  // first, else on the first page.
  useNavLanding(fetchPage, pages, activePageId, nav.visit, landingPageId, doc.cache);

  // Ancestor shells for a child page: walk placements upwards. The preview
  // only reads the rendered levels; the records exist for the editor.
  const host = useHostChain(fetchPage, page, doc.cache).levels;

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    window.setTimeout(() => setToastMsg((cur) => (cur === msg ? null : cur)), 2200);
  }, []);

  const followLink = useCallback(
    (target: LinkTarget) => {
      if (target.pageId === BACK_PAGE_ID) {
        if (nav.canBack) nav.back();
        else toast("No previous page to go back to");
      } else if (pages.some((p) => p.id === target.pageId)) {
        nav.visit(target.pageId);
      } else {
        toast("The linked page no longer exists");
      }
    },
    [pages, toast, nav.visit, nav.back, nav.canBack], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const activePageIds = useMemo(
    () => (page ? [page.id, ...host.map((h) => h.pageId)] : []),
    [page?.id, host], // eslint-disable-line react-hooks/exhaustive-deps
  );

  /** Close an open modal/drawer: back along the trail, else to the backdrop
   *  page it floats over (a preview opened straight onto the overlay). */
  const dismissOverlay = useCallback(() => {
    if (nav.canBack) nav.back();
    else if (host.length) nav.visit(host[host.length - 1].pageId);
    else toast("No previous page to go back to");
  }, [host, toast, nav.canBack, nav.back, nav.visit]); // eslint-disable-line react-hooks/exhaustive-deps

  // Escape closes the overlay, like the dialog it stands for.
  useEffect(() => {
    if (!page?.presentation) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismissOverlay();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [page?.presentation, dismissOverlay]); // eslint-disable-line react-hooks/exhaustive-deps

  const framed = interfaceType !== "desktop";
  const device = deviceClass(interfaceType);
  const stageFit = useStageFit(canvasWrap, interfaceType);
  // Desktop pages widen for their fixed-px columns and the canvas scrolls to
  // them; a framed device keeps its screen width, like the hardware it draws.
  const minDeviceWidth = !framed && page ? deviceMinWidth(page.document, host, page.presentation) : 0;
  // A switch in flight dims the (still rendered) outgoing page after a beat;
  // a fast switch shows nothing at all (see .page-switching in studio.css).
  const pageSwitching = !!page && (page.id !== activePageId || pendingPageId !== null);

  return (
    <div className="studio studio-preview">
      <div className="topbar">
        {chrome}
        <div className="spacer" />
        <div className="page-nav">
          <button className="btn ghost" disabled={!nav.canBack} title="Back to previous page" onClick={nav.back}>
            ‹
          </button>
          <button className="btn ghost" disabled={!nav.canForward} title="Forward to next page" onClick={nav.forward}>
            ›
          </button>
        </div>
      </div>
      {banner}
      {notice && (
        <div className="status-banner warn">
          {notice}{" "}
          <button className="btn small ghost" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      )}

      <div className="preview-body">
        <div className={`canvas-wrap${framed ? " framed" : ""}`} ref={canvasWrap}>
          <Stage fit={stageFit}>
          <div className={`device ${device}${pageSwitching ? " page-switching" : ""}`} style={stageFit ? stageFit.device : minDeviceWidth > 0 ? { minWidth: minDeviceWidth } : undefined}>
            {page ? (
              <PreviewCanvas
                doc={page.document}
                host={host}
                presentation={page.presentation}
                activePageIds={activePageIds}
                defs={project.custom_components as CustomDef[]}
                datasets={datasetsLoad.data ?? []}
                onFollow={followLink}
                onDismiss={dismissOverlay}
              />
            ) : pages.length === 0 ? (
              <div className="frame-body flat">
                <div className="empty-hint">{emptyHint}</div>
              </div>
            ) : (
              <div className="frame-body flat">
                <div className="empty-hint">Loading page…</div>
              </div>
            )}
          </div>
          </Stage>
        </div>
      </div>

      <div className={`toast${toastMsg ? " show" : ""}`}>{toastMsg}</div>
    </div>
  );
}
