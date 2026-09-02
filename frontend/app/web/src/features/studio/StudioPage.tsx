// The studio: three-pane editor (library · canvas · inspector) over one page
// of a wireframe, with page tabs, undo/redo, the component builder, and
// immediate persistence through the outbox. The custom component library
// belongs to the project, so it is shared by every wireframe in it.
//
// Every edit is `history.commit(draft => action(draft, ctx, ...))`: the
// action mutates the draft, the history hook diffs it into id-addressed ops
// and hands them to the outbox, and the UI re-renders from the new state.
//
// A page is a split tree of regions. A page with a `placement` is a child
// page: the canvas renders its ancestors' shells read-only around it (the
// outlet model behind region-targeted links).
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { ConfirmDrawer } from "../../components/ConfirmDrawer";
import { Drawer, Field } from "../../components/Drawer";
import { errorMessage } from "../../core/api";
import { useLoad } from "../../core/useLoad";
import { useProject } from "../project/ProjectLayout";
import {
  createWireframePage,
  createWireframeVersion,
  deleteWireframePage,
  getWireframe,
  getWireframePage,
  listWireframeVersions,
  sendWireframeOpBatch,
} from "../project/wireframes/wireframesApi";
import { replaceCustomComponents } from "../projects/projectsApi";
import { Builder } from "./builder/Builder";
import { elementMeta } from "./catalog";
import { Canvas, HostLevel } from "./components/Canvas";
import { Inspector } from "./components/Inspector";
import { Library, LibTab } from "./components/Library";
import { PageSelect } from "./components/PageSelect";
import { PanelRail } from "./components/PanelRail";
import { SchematicEdit } from "./components/Schematic";
import { ElementSel, Selection } from "./components/selection";
import * as A from "./model/actions";
import { ActionContext, ActionResult, CustomDef, elementLink, elementValue, elKey, EL_PREFIX, isElKey, locateCmp } from "./model/actions";
import { PageLike } from "./model/applyOps";
import { diffPage } from "./model/diff";
import { usePageHistory } from "./model/history";
import { byPos, isLegacyDocument, normalizePage, posAfterLast } from "./model/positions";
import { contentRegionFor, regionDisplayName, regionIds } from "./model/tree";
import { BACK_PAGE_ID, LayoutNode, LinkTarget, PageRecord } from "./model/types";
import { defaultBatchId } from "./sync/outbox";
import { useWireframeSync } from "./sync/useWireframeSync";
import { usePageNav } from "./usePageNav";

/** Input types where the browser keeps its own text-undo stack; Ctrl+Z in
 *  one of these must edit the text, never the canvas. */
const TEXT_INPUT_TYPES = new Set(["text", "search", "url", "tel", "email", "password", "number", "date", "time", "datetime-local", "month", "week"]);

const isTextEditing = (el: HTMLElement): boolean =>
  el.tagName === "TEXTAREA" ||
  el.isContentEditable ||
  (el.tagName === "INPUT" && TEXT_INPUT_TYPES.has((el as HTMLInputElement).type));

export function StudioPage() {
  const { wireframeId = "" } = useParams();
  const { project, canWrite } = useProject();
  const projectId = project.id;
  const wireframe = useLoad(() => getWireframe(projectId, wireframeId), [projectId, wireframeId]);
  const [customComponents, setCustomComponents] = useState<CustomDef[]>([]);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [page, setPage] = useState<PageRecord | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [editingElement, setEditingElement] = useState<ElementSel | null>(null);
  const [host, setHost] = useState<HostLevel[]>([]);
  const [libTab, setLibTab] = useState<LibTab>("components");
  const [builder, setBuilder] = useState<{ open: boolean; defId: string | null }>({ open: false, defId: null });
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Drawers: new page and the delete confirmation.
  const [pageDraft, setPageDraft] = useState<{ name: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: string } | null>(null);
  const [busy, setBusy] = useState(false);
  /** Manual snapshots saved so far; the topbar shows this as the version number. */
  const [versionCount, setVersionCount] = useState<number | null>(null);
  /** A pre-tree document was reset on load; persist the reset once the state settles. */
  const [pendingReset, setPendingReset] = useState<{ pageId: string; root: LayoutNode } | null>(null);
  /** Load-time normalisation (legacy component migration, pos repair) to
   *  persist as one batch, so the stored document catches up with what the
   *  editor shows and later per-key edits land on the converted form. */
  const [pendingMigrate, setPendingMigrate] = useState<{ pageId: string; ops: ReturnType<typeof diffPage> } | null>(null);

  const pages = useMemo(() => byPos(wireframe.data?.pages ?? []), [wireframe.data]);
  const nav = usePageNav(pages, activePageId, setActivePageId);

  useEffect(() => {
    setCustomComponents(project.custom_components as CustomDef[]);
  }, [project.custom_components]);

  useEffect(() => {
    if (!activePageId && pages.length) nav.visit(pages[0].id);
    if (activePageId && pages.length && !pages.some((p) => p.id === activePageId)) nav.visit(pages[0].id);
  }, [pages, activePageId, nav.visit]);

  useEffect(() => {
    if (!activePageId) return;
    let cancelled = false;
    setPage(null);
    getWireframePage(projectId, wireframeId, activePageId)
      .then((p) => {
        if (cancelled) return;
        const legacy = isLegacyDocument(p.document);
        const normalised = normalizePage(p);
        setPage(normalised);
        setSelection(null);
        setEditingElement(null);
        setPendingReset(legacy && canWrite ? { pageId: normalised.id, root: normalised.document.root } : null);
        const migrationOps = !legacy && canWrite ? diffPage(p, normalised) : [];
        setPendingMigrate(migrationOps.length ? { pageId: normalised.id, ops: migrationOps } : null);
      })
      .catch((err) => setNotice(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [projectId, wireframeId, activePageId, canWrite]);

  const sync = useWireframeSync(projectId, wireframeId, page, setPage);
  /** Settled = loaded and any load-time migration/reset already sent, so a
   *  cross-page undo lands on the same normalised form its snapshot used. */
  const pageReady =
    !!page &&
    (!pendingReset || pendingReset.pageId !== page.id) &&
    (!pendingMigrate || pendingMigrate.pageId !== page.id);
  const pageExists = useCallback((id: string) => pages.some((p) => p.id === id), [pages]);
  const history = usePageHistory(page, sync, {
    ready: pageReady,
    reset: sync.reset,
    pageExists,
    navigateTo: nav.visit,
  });

  // Persist the reset of a pre-tree document (one "set root" op) once the
  // sync hook can see the normalised page.
  useEffect(() => {
    if (pendingReset && page?.id === pendingReset.pageId) {
      sync.commit([{ op: "set", path: "root", value: pendingReset.root }]);
      setPendingReset(null);
    }
  }, [pendingReset, page, sync]);

  // Persist load-time migration the same way; the diff of raw → normalised
  // applied to the stored document reproduces exactly what the editor shows.
  useEffect(() => {
    if (pendingMigrate && page?.id === pendingMigrate.pageId) {
      sync.commit(pendingMigrate.ops);
      setPendingMigrate(null);
    }
  }, [pendingMigrate, page, sync]);

  // Ancestor shells for a child page: walk placements upwards.
  useEffect(() => {
    let cancelled = false;
    setHost([]);
    if (!page?.placement) return;
    const load = async () => {
      const levels: HostLevel[] = [];
      const seen = new Set<string>([page.id]);
      let placement = page.placement;
      while (placement && !seen.has(placement.page_id) && levels.length < 6) {
        try {
          const parent = normalizePage(await getWireframePage(projectId, wireframeId, placement.page_id));
          if (!regionIds(parent.document.root).includes(placement.region_id)) break;
          levels.unshift({ pageId: parent.id, doc: parent.document, regionId: placement.region_id });
          seen.add(parent.id);
          placement = parent.placement;
        } catch {
          break;
        }
      }
      if (!cancelled) setHost(levels);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [page?.id, page?.placement, projectId, wireframeId]);

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    window.setTimeout(() => setToastMsg((cur) => (cur === msg ? null : cur)), 2200);
  }, []);

  const persistDefs = useCallback(
    (defs: CustomDef[]) => {
      setCustomComponents(defs);
      replaceCustomComponents(projectId, defs).catch((err) => setNotice(errorMessage(err)));
    },
    [projectId],
  );

  const ctx: ActionContext = useMemo(() => ({ customComponents }), [customComponents]);

  /** Run an action through history, apply its UI hints and hand it back so
   *  callers can chain on what was created (e.g. a nav item's page). */
  const run = useCallback(
    (fn: (draft: PageLike, ctx: ActionContext) => ActionResult | void, coalesceKey?: string): ActionResult | void => {
      if (!canWrite) return;
      const result = history.commit((draft) => fn(draft, ctx), { coalesceKey });
      if (!result) return;
      if (result.selectElement !== undefined) {
        setSelection({ kind: "element", ...result.selectElement });
      } else if (result.selectRegionId !== undefined) {
        setSelection(result.selectRegionId ? { kind: "region", id: result.selectRegionId } : null);
      } else if (result.selectCmpId !== undefined) {
        setSelection(result.selectCmpId ? { kind: "cmp", id: result.selectCmpId } : null);
      }
      if (result.toast) toast(result.toast);
      if (result.newDef) persistDefs([...customComponents, result.newDef]);
      return result;
    },
    [canWrite, history, ctx, toast, persistDefs, customComponents],
  );

  const selectedCmpId = selection?.kind === "cmp" ? selection.id : selection?.kind === "element" ? selection.cmpId : null;
  const selectedCmp = page && selectedCmpId ? (locateCmp(page.document, selectedCmpId)?.list[locateCmp(page.document, selectedCmpId)!.index] ?? null) : null;

  /** Where a library click lands: the selected region, the selected component's region, else the first region. */
  const targetRegionId = (): string | null => {
    if (!page) return null;
    if (selection?.kind === "region") return selection.id;
    if (selectedCmpId) return locateCmp(page.document, selectedCmpId)?.region ?? null;
    return null;
  };

  // Clicking dead space outside the canvas — the inspector or library
  // background, the topbar — clears the selection, mirroring the gutter
  // click inside the canvas. Exempt: the canvas itself (it owns its own
  // deselect above), every control and its `.field` row (changing a
  // property must never deselect), and clickable non-button UI (library
  // items, tabs, the page picker). NOTE: a new clickable div outside the
  // canvas needs its class added here, or its click will clear the
  // selection it just set.
  const outsideDeadSpace = (target: HTMLElement) =>
    !target.closest(
      ".canvas-wrap, button, input, select, textarea, label, a, [contenteditable='true'], [role='button'], .field, .lib-item, .lib-shape, .tab, .page-select, .toast",
    );
  /** Whether the current press started on dead space (see the root onClick). */
  const pressOnDeadSpace = useRef(false);

  // Keyboard: undo/redo, panel toggles, element editing.
  const dialogOpen = builder.open || !!pageDraft || !!pendingDelete;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (dialogOpen) return;
      const target = e.target as HTMLElement;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && !e.altKey && (key === "z" || key === "y")) {
        // Undo/redo fire from anywhere except a live text edit, where the
        // browser's own text undo must win. A select or a colour swatch has
        // no text undo, so keeping focus there must not swallow Ctrl+Z.
        if (isTextEditing(target)) return;
        if (key === "y" || e.shiftKey) history.redo();
        else history.undo();
        e.preventDefault();
        return;
      }
      // Every other shortcut defers to whatever control holds focus.
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable) return;
      if (mod && e.key.toLowerCase() === "b") { setLeftCollapsed((v) => !v); e.preventDefault(); }
      else if (mod && e.key.toLowerCase() === "i") { setRightCollapsed((v) => !v); e.preventDefault(); }
      else if ((e.key === "Enter" || e.key === "F2") && selection?.kind === "element" && canWrite) {
        setEditingElement(selection);
        e.preventDefault();
      } else if ((e.key === "Delete" || e.key === "Backspace") && selection?.kind === "element" && isElKey(selection.key) && canWrite) {
        run((d, c) => A.removeElement(d, c, selection.cmpId, selection.key.slice(EL_PREFIX.length)));
        e.preventDefault();
      } else if (e.key.toLowerCase() === "p" && !mod && !e.altKey && selection) {
        // Step the selection up one level: element → its component → its
        // region. The only way to reach a region a full-bleed component covers.
        if (selection.kind === "element") {
          setSelection({ kind: "cmp", id: selection.cmpId });
          setEditingElement(null);
          e.preventDefault();
        } else if (selection.kind === "cmp" && page) {
          const region = locateCmp(page.document, selection.id)?.region;
          if (region) setSelection({ kind: "region", id: region });
          e.preventDefault();
        }
      } else if (e.key === "Escape") {
        setSelection(null);
        setEditingElement(null);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [history, dialogOpen, selection, canWrite, run, page]);

  // ── Pages (wireframe-level REST) ─────────────────────────────────────────

  // The route is always derived from the name — pages carry one identity,
  // whether created from the drawer, from a linked element, or renamed later.
  const slugOf = (name: string) => "/" + name.trim().toLowerCase().replace(/\s+/g, "-");

  const openAddPage = () => setPageDraft({ name: "New page" });

  const submitPage = async (e: FormEvent) => {
    e.preventDefault();
    if (!pageDraft || !pageDraft.name.trim()) return;
    setBusy(true);
    try {
      const created = await createWireframePage(projectId, wireframeId, {
        name: pageDraft.name.trim(),
        route: slugOf(pageDraft.name),
        pos: posAfterLast(pages),
      });
      await wireframe.reload();
      nav.visit(created.id);
      setPageDraft(null);
    } catch (err) {
      setNotice(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const removePage = (id: string) => {
    if (pages.length > 1) setPendingDelete({ id });
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    await deleteWireframePage(projectId, wireframeId, pendingDelete.id);
    await wireframe.reload();
    if (activePageId === pendingDelete.id) setActivePageId(null);
  };

  // ── Versions ──────────────────────────────────────────────────────────────

  // The topbar version number counts manual saves only: the backend also
  // snapshots automatically around conflicts and replays, and those must not
  // bump the number the user sees.
  useEffect(() => {
    let cancelled = false;
    listWireframeVersions(projectId, wireframeId)
      .then((versions) => {
        if (!cancelled) setVersionCount(versions.filter((v) => v.reason === "manual").length);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId, wireframeId]);

  const saveVersion = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await createWireframeVersion(projectId, wireframeId);
      const next = (versionCount ?? 0) + 1;
      setVersionCount(next);
      toast(`Saved snapshot v${next}`);
    } catch (err) {
      setNotice(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  // ── Links ─────────────────────────────────────────────────────────────────

  const followLink = useCallback(
    (target: LinkTarget) => {
      if (target.pageId === BACK_PAGE_ID) {
        // Form-like behaviour: a Cancel/Save link returns the user to
        // wherever they came from rather than a fixed page.
        if (nav.canBack) nav.back();
        else toast("No previous page to go back to");
      } else if (pages.some((p) => p.id === target.pageId)) {
        nav.visit(target.pageId);
      } else {
        toast("The linked page no longer exists");
      }
    },
    [pages, toast, nav.visit, nav.back, nav.canBack],
  );

  const createLinkedPage = async (sel: ElementSel, regionId: string | null, nameOverride?: string) => {
    if (!page || busy) return;
    const seed = nameOverride ?? (selectedCmp ? elementValue(selectedCmp, sel.key, sel.index) : "");
    const name = seed.trim() || "New page";
    setBusy(true);
    try {
      const created = await createWireframePage(projectId, wireframeId, {
        name,
        route: slugOf(name),
        pos: posAfterLast(pages),
        placement: regionId ? { page_id: page.id, region_id: regionId } : undefined,
      });
      await wireframe.reload();
      run((d, c) => A.setElementLink(d, c, sel.cmpId, sel.key, sel.index, { pageId: created.id }));
      toast(
        regionId
          ? `Created "${name}" inside ${regionDisplayName(page.document.root, regionId)} — double-click the element to open it`
          : `Created page "${name}" — double-click the element to open it`,
      );
    } catch (err) {
      setNotice(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  /** Rename a page that is NOT open in the editor: the op outbox only serves
   *  the open page, so this sends one direct batch, then refreshes the list. */
  const renameLinkedPage = async (pageId: string, name: string) => {
    try {
      const target = await getWireframePage(projectId, wireframeId, pageId);
      await sendWireframeOpBatch(projectId, wireframeId, {
        clientBatchId: defaultBatchId(),
        pageId,
        baseVersion: target.version,
        ops: [
          { op: "set", path: "name", value: name },
          { op: "set", path: "route", value: slugOf(name) },
        ],
      });
      await wireframe.reload();
    } catch {
      // Cosmetic only — the element's link still resolves by id.
    }
  };

  /** Commit an element's text. A linked page whose name still matches the old
   *  text is renamed with it, so a nav item and its page stay one identity; a
   *  page renamed on its own keeps its name. */
  const commitElementText = (sel: ElementSel, text: string) => {
    const loc = page ? locateCmp(page.document, sel.cmpId) : null;
    const cmp = loc ? loc.list[loc.index] : null;
    const before = cmp ? elementValue(cmp, sel.key, sel.index) : "";
    const link = cmp ? elementLink(cmp, sel.key, sel.index) : null;
    const name = (text || "").trim();
    const targetName =
      link && link.pageId !== BACK_PAGE_ID
        ? link.pageId === page?.id
          ? page.name
          : pages.find((p) => p.id === link.pageId)?.name
        : undefined;
    const follow = !!link && !!name && name !== before && targetName === before;
    if (follow && link && link.pageId === page?.id) {
      // The element links to its own page: one commit, one undo step.
      run((d, c) => {
        const result = A.setElementText(d, c, sel.cmpId, sel.key, sel.index, text);
        d.name = name;
        d.route = slugOf(name);
        return result;
      });
      void wireframe.reload();
      return;
    }
    run((d, c) => A.setElementText(d, c, sel.cmpId, sel.key, sel.index, text));
    if (follow && link) void renameLinkedPage(link.pageId, name);
  };

  /** Add an element. A nav item added to a nav bar also gets a page of its
   *  own, placed in the content region that nav bar serves — its immediate
   *  child region (see contentRegionFor). */
  const addElementTo = (cmpId: string, type: string) => {
    const loc = page ? locateCmp(page.document, cmpId) : null;
    const hostCmp = loc ? loc.list[loc.index] : null;
    const result = run((d, c) => A.addElement(d, c, cmpId, type));
    const created = result?.selectElement;
    if (!created || !page || !loc || hostCmp?.type !== "navbar" || type !== "nav-item") return;
    const regionId = contentRegionFor(page.document.root, loc.region);
    if (!regionId) return;
    void createLinkedPage(created, regionId, elementMeta("navbar", "nav-item")?.defaultLabel ?? "Item");
  };

  // ── Builder ───────────────────────────────────────────────────────────────

  const openBuilderFor = (cmpId: string) => {
    const loc = page && locateCmp(page.document, cmpId);
    const node = loc ? loc.list[loc.index] : null;
    if (!node) return;
    if (node.type === "custom") {
      if (node.customId) setBuilder({ open: true, defId: node.customId });
      return;
    }
    if (node.type !== "editable-component") return;
    const existing = node.customId && customComponents.find((d) => d.id === node.customId);
    if (existing) {
      setBuilder({ open: true, defId: existing.id });
      return;
    }
    // Link a definition to a legacy instance that has none, then open it.
    const created = A.createEditableDefinition(node.label, customComponents);
    run((d) => {
      const loc2 = locateCmp(d.document, cmpId);
      if (loc2) loc2.list[loc2.index].customId = created.id;
      return { newDef: created };
    });
    setBuilder({ open: true, defId: created.id });
  };

  // Plain function, not useCallback: commitElementText/addElementTo close
  // over the current page and pages, so memoising on `run` alone would hand
  // the canvas stale closures.
  const editFor = (id: string): SchematicEdit => ({
    setPropValue: (key, text) => run((d, c) => A.setPropValue(d, c, id, key, text)),
    setElementLabel: (elId, text) => commitElementText({ cmpId: id, key: elKey(elId), index: null }, text),
    setElementData: (elId, key, value) => run((d, c) => A.setElementData(d, c, id, elId, key, value)),
    addElement: (type) => addElementTo(id, type),
    removeElement: (elId) => run((d, c) => A.removeElement(d, c, id, elId)),
    addRow: () => run((d, c) => A.addListRow(d, c, id)),
    setListCell: (row, columnId, text) => run((d, c) => A.setListCell(d, c, id, row, columnId, text)),
    moveElementTo: (elId, x, y) => run((d, c) => A.setElementPosition(d, c, id, elId, x, y)),
    resizeElementTo: (elId, w, h) => run((d, c) => A.setElementSize(d, c, id, elId, w, h)),
    reorderElement: (srcId, targetId, before) => run((d, c) => A.reorderElement(d, c, id, srcId, targetId, before)),
  });

  /** The open page plus its ancestor shells: a nav item linking to any of
   *  these renders as the current tab (see SchematicChrome.activePageIds). */
  const activePageIds = useMemo(
    () => (page ? [page.id, ...host.map((h) => h.pageId)] : []),
    [page?.id, host], // eslint-disable-line react-hooks/exhaustive-deps
  );

  if (wireframe.loading) return <div className="page muted">Loading…</div>;
  if (wireframe.error || !wireframe.data) return <div className="page error">{wireframe.error ?? "Not found"}</div>;

  const builderInitial = builder.defId ? customComponents.find((d) => d.id === builder.defId) ?? null : null;

  // Mobile and tablet wireframes edit inside a device-shaped stage; desktop
  // keeps the full-bleed canvas (see "Device stage" in studio.css).
  const interfaceType = wireframe.data.interface_type;
  const framed = interfaceType !== "desktop";

  return (
    <div
      className="studio"
      onPointerDownCapture={(e) => {
        pressOnDeadSpace.current = !dialogOpen && outsideDeadSpace(e.target as HTMLElement);
      }}
      onClick={(e) => {
        // Deselect only when the press AND the release both landed on dead
        // space: a text-selection drag out of an input must not deselect,
        // and click (not pointerdown) so a control's blur-commit runs
        // before the inspector section unmounts.
        if (pressOnDeadSpace.current && outsideDeadSpace(e.target as HTMLElement)) {
          setSelection(null);
          setEditingElement(null);
        }
      }}
    >
      <div className="topbar">
        <div className="brand">{wireframe.data.name}{!canWrite && <span className="v"> · read only</span>}</div>
        {versionCount !== null && <div className="crumbs"><b>v{versionCount}</b></div>}
        <div className="spacer" />
        <div className="page-nav">
          <button className="btn ghost" disabled={!nav.canBack} title="Back to previous page" onClick={nav.back}>‹</button>
          <button className="btn ghost" disabled={!nav.canForward} title="Forward to next page" onClick={nav.forward}>›</button>
        </div>
        <PageSelect pages={pages} activeId={activePageId} canWrite={canWrite} onSelect={nav.visit} onAdd={openAddPage} onDelete={removePage} />
        {canWrite && (
          <>
            <button className="btn ghost" disabled={!history.canUndo} title="Undo (Ctrl/⌘+Z)" onClick={history.undo}>↶ Undo</button>
            <button className="btn ghost" disabled={!history.canRedo} title="Redo (Ctrl/⌘+Shift+Z)" onClick={history.redo}>↷ Redo</button>
            <button className="btn ghost" disabled={busy} title="Save a snapshot of this wireframe" onClick={() => void saveVersion()}>Save snapshot</button>
          </>
        )}
      </div>
      {notice && <div className="status-banner warn">{notice} <button className="btn small ghost" onClick={() => setNotice(null)}>Dismiss</button></div>}
      {sync.conflict && <div className="status-banner warn">{sync.conflict}</div>}

      <div className="workspace">
        <div className={`app${leftCollapsed ? " left-collapsed" : ""}${rightCollapsed ? " right-collapsed" : ""}`}>
          {leftCollapsed ? (
            <PanelRail side="left" label="Library" shortcut="Ctrl/⌘+B" onExpand={() => setLeftCollapsed(false)} />
          ) : (
          <Library
            onCollapse={() => setLeftCollapsed(true)}
            tab={libTab}
            onTab={setLibTab}
            customComponents={customComponents}
            selectedCmpType={selectedCmp?.type ?? null}
            canWrite={canWrite}
            onApplyPattern={(id) => run((d, c) => A.applyPattern(d, c, id))}
            onAddComponent={(type, customId, shapeId) =>
              run((d, c) => A.appendComponent(d, c, { type, shape: shapeId }, targetRegionId(), null, customId ?? null))
            }
            onAddElement={(type) => {
              if (selectedCmpId) addElementTo(selectedCmpId, type);
            }}
            onNewCustom={() => setBuilder({ open: true, defId: null })}
            onEditCustom={(id) => setBuilder({ open: true, defId: id })}
          />
          )}

          <section className="panel center">
            <div
              className={`canvas-wrap${framed ? " framed" : ""}`}
              onClick={(e) => {
                // Clicking off — the gutter around the page, or dead space
                // inside it — clears the selection. Anything selectable or
                // interactive handles (or guards) its own clicks.
                if ((e.target as HTMLElement).closest(".cmp, .rg, .rg-toolbar, .split-div")) return;
                setSelection(null);
              }}
            >
              <div className={`device ${interfaceType}`}>
                {page ? (
                  <Canvas
                    doc={page.document}
                    host={host}
                    activePageIds={activePageIds}
                    selection={selection}
                    editingElement={editingElement}
                    defs={customComponents}
                    canWrite={canWrite}
                    onSelect={setSelection}
                    editFor={editFor}
                    onEditEnd={() => setEditingElement(null)}
                    onFollow={followLink}
                    onMove={(id, delta) => run((d, c) => A.moveComponent(d, c, id, delta))}
                    onRemove={(id) => run((d, c) => A.removeComponent(d, c, id))}
                    onEditStructure={openBuilderFor}
                    onDropPattern={(id, regionId) => run((d, c) => A.applyPattern(d, c, id, regionId))}
                    onDropComponent={(type, customId, regionId, index, shapeId) =>
                      run((d, c) => A.appendComponent(d, c, { type, shape: shapeId }, regionId, index, customId ?? null))
                    }
                    onDropElement={(type, cmpId) => addElementTo(cmpId, type)}
                    onReorder={(src, target, before) => run((d, c) => A.reorderById(d, c, src, target, before))}
                    onMoveToRegion={(src, regionId) => run((d, c) => A.moveToRegion(d, c, src, regionId))}
                    onSplit={(regionId, side) => run((d, c) => A.splitRegionAction(d, c, regionId, side))}
                    onRemoveRegion={(regionId) => run((d, c) => A.removeRegionAction(d, c, regionId))}
                    onResize={(changes) => run((d, c) => A.resizeNodes(d, c, changes))}
                  />
                ) : (
                  <div className="frame-body flat"><div className="empty-hint">Loading page…</div></div>
                )}
              </div>
            </div>
          </section>

          {rightCollapsed ? (
            <PanelRail side="right" label="Inspector" shortcut="Ctrl/⌘+I" onExpand={() => setRightCollapsed(false)} />
          ) : page ? (
            <Inspector
              onCollapse={() => setRightCollapsed(true)}
              page={page}
              pages={pages}
              selection={selection}
              selectedCmp={selectedCmp}
              canWrite={canWrite}
              onPageField={(field, value) => run((d) => { d[field] = value; d.route = slugOf(value); }, `page.${field}`)}
              onCmpType={(id, type) => run((d, c) => A.setComponentType(d, c, id, type))}
              onCmpShape={(id, shapeId) => run((d, c) => A.setComponentShape(d, c, id, shapeId))}
              onCmpLayout={(id, layoutId) => run((d, c) => A.setComponentLayout(d, c, id, layoutId))}
              onCmpLabel={(id, label) => run((d, c) => A.setComponentLabel(d, c, id, label), `label.${id}`)}
              onCmpProp={(id, key, value) => run((d, c) => A.setPropValue(d, c, id, key, value), `prop.${id}.${key}`)}
              onRegionLabel={(id, label) => run((d, c) => A.setRegionLabelAction(d, c, id, label), `region.${id}`)}
              onRegionBg={(id, bg) => run((d, c) => A.setRegionBgAction(d, c, id, bg), `region-bg.${id}`)}
              onRegionSize={(id, size) => run((d, c) => A.resizeNodes(d, c, [{ id, size }]))}
              onSplit={(id, side) => run((d, c) => A.splitRegionAction(d, c, id, side))}
              onRemoveRegion={(id) => run((d, c) => A.removeRegionAction(d, c, id))}
              onElementText={commitElementText}
              onElementData={(sel, key, value) => {
                if (isElKey(sel.key)) run((d, c) => A.setElementData(d, c, sel.cmpId, sel.key.slice(EL_PREFIX.length), key, value), `eldata.${sel.cmpId}.${sel.key}.${key}`);
              }}
              onMoveElement={(sel, delta) => {
                if (isElKey(sel.key)) run((d, c) => A.moveElement(d, c, sel.cmpId, sel.key.slice(EL_PREFIX.length), delta));
              }}
              onRemoveElement={(sel) => {
                if (isElKey(sel.key)) run((d, c) => A.removeElement(d, c, sel.cmpId, sel.key.slice(EL_PREFIX.length)));
              }}
              onSetLink={(sel, target) => run((d, c) => A.setElementLink(d, c, sel.cmpId, sel.key, sel.index, target))}
              onCreateLinkedPage={(sel, regionId) => void createLinkedPage(sel, regionId)}
            />
          ) : (
            <aside className="panel" id="rightPanel"><div className="panel-head">Inspector</div></aside>
          )}
        </div>
      </div>

      <Drawer
        open={!!pageDraft}
        title="New page"
        description="A page is one screen of this wireframe; its URL comes from its name."
        onClose={() => setPageDraft(null)}
        onSubmit={submitPage}
        footer={
          <>
            <button type="button" className="btn ghost" onClick={() => setPageDraft(null)}>Cancel</button>
            <button className="btn primary" disabled={busy || !pageDraft?.name.trim()}>{busy ? "Creating…" : "Create page"}</button>
          </>
        }
      >
        <Field label="Name" hint={pageDraft?.name.trim() ? `Route ${slugOf(pageDraft.name)}` : undefined}>
          <input
            className="input"
            required
            value={pageDraft?.name ?? ""}
            onChange={(e) => setPageDraft((d) => d && { ...d, name: e.target.value })}
          />
        </Field>
      </Drawer>

      <ConfirmDrawer
        open={!!pendingDelete}
        title="Delete page"
        onClose={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
      >
        <p>
          Delete <b>{pages.find((p) => p.id === pendingDelete?.id)?.name ?? "this page"}</b>? Pages linked inside its regions
          become top-level. Saved versions keep their copy.
        </p>
      </ConfirmDrawer>

      {builder.open && (
        <Builder
          key={builder.defId ?? "new"}
          initial={builderInitial}
          toast={toast}
          onClose={() => setBuilder({ open: false, defId: null })}
          onSave={(def) => {
            const idx = customComponents.findIndex((d) => d.id === def.id);
            const next = idx >= 0 ? customComponents.map((d) => (d.id === def.id ? def : d)) : [...customComponents, def];
            persistDefs(next);
            setBuilder({ open: false, defId: null });
            setLibTab("custom");
            toast(`Saved "${def.name}"`);
          }}
          onDelete={(id) => {
            persistDefs(customComponents.filter((d) => d.id !== id));
            setBuilder({ open: false, defId: null });
            toast("Component deleted");
          }}
        />
      )}

      <div className={`toast${toastMsg ? " show" : ""}`}>{toastMsg}</div>
    </div>
  );
}
