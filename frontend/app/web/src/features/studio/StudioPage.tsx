// The studio: canvas + inspector over one page of a wireframe, with the
// library as two slim bars (components under the top bar, the selected
// component's elements under the canvas), page tabs, undo/redo, the
// component builder, and immediate persistence through the outbox. The
// custom component library belongs to the project, so it is shared by every
// wireframe in it.
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
import { createDataset, deleteDataset, listDatasets, updateDataset } from "../project/datasets/datasetsApi";
import { useProject } from "../project/ProjectLayout";
import {
  AnnotationKind,
  createWireframeAnnotation,
  deleteWireframeAnnotation,
  listWireframeAnnotations,
  updateWireframeAnnotation,
  WireframeAnnotation,
} from "../project/wireframes/annotationsApi";
import {
  createWireframePage,
  createWireframeVersion,
  deleteWireframePage,
  deviceClass,
  getWireframe,
  getWireframePage,
  listWireframeVersions,
  sendWireframeOpBatch,
  updateWireframe,
} from "../project/wireframes/wireframesApi";
import { replaceCustomComponents } from "../projects/projectsApi";
import { Stage, stageScale, useStageFit } from "./stage";
import { Builder } from "./builder/Builder";
import { COMPONENTS, DATA_KINDS, DataKind, elementMeta } from "./catalog";
import { AnnotationsPanel, ComposerTarget, TargetInfo } from "./components/AnnotationsPanel";
import { AnnotationMarks, Canvas, deviceMinWidth, HotMark } from "./components/Canvas";
import { Inspector } from "./components/Inspector";
import { ComponentBar, ElementBar } from "./components/LibraryBar";
import { PageSelect } from "./components/PageSelect";
import { PanelCollapse, PanelRail } from "./components/PanelRail";
import { SchematicEdit } from "./components/Schematic";
import { ElementSel, Selection } from "./components/selection";
import * as A from "./model/actions";
import { ActionContext, ActionResult, CustomDef, elementLink, elementValue, elKey, EL_PREFIX, findElement, isElKey, linkedRegionLabel, locateCmp, relabelLinkedRegion } from "./model/actions";
import { PageLike } from "./model/applyOps";
import { ClipboardItem, copyComponentItem, copyElementItem, pasteComponent, pasteElement, readClipboard, storeClipboard } from "./model/clipboard";
import {
  ARCHIVE_ACTION_LABEL,
  buildEditDocument,
  crudDisabledReason,
  crudGaps,
  EDIT_ACTION_LABEL,
  editPageName,
  FILTER_DEFAULT,
  FILTER_FALLBACK_OPTIONS,
  FILTER_LABEL,
  RECORD_STATUS_DATASET_ID,
} from "./model/crud";
import { diffPage } from "./model/diff";
import { usePageHistory } from "./model/history";
import { ComposedLevel, composeRegionOptions } from "./model/linkRegions";
import { firstNavTarget, navLinkedPageIds, orderPagesByNav } from "./model/navOrder";
import { byPos, isLegacyDocument, posAfterLast } from "./model/positions";
import { blankDocument, contentRegionFor, fallbackRegionId, findNode, regionDisplayName } from "./model/tree";
import { BACK_PAGE_ID, ComponentNode, LayoutNode, LinkTarget, Op, PageDocument, PagePresentation, PageRecord } from "./model/types";
import { defaultBatchId } from "./sync/outbox";
import { useWireframeSync } from "./sync/useWireframeSync";
import { useHostChain } from "./useHostChain";
import { useNavLanding } from "./useNavLanding";
import { useLivePages, usePageDocument } from "./usePageDocument";
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
  const { project, canWrite, canAddTasks } = useProject();
  const projectId = project.id;
  const wireframe = useLoad(() => getWireframe(projectId, wireframeId), [projectId, wireframeId]);
  const [customComponents, setCustomComponents] = useState<CustomDef[]>([]);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [editingElement, setEditingElement] = useState<ElementSel | null>(null);
  const [builder, setBuilder] = useState<{ open: boolean; defId: string | null }>({ open: false, defId: null });
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [rightTab, setRightTab] = useState<"inspector" | "notes" | "tasks">("inspector");
  /** A jump to another page — an annotation row, or a link just set: the
   *  selection is applied once the page arrives (the page-change effect
   *  clears selection first). A null `sel` means "whatever region this page
   *  lands in", resolvable only after its document has loaded. */
  const [pendingReveal, setPendingReveal] = useState<{ pageId: string; sel: Selection | null } | null>(null);
  /** The annotation target hovered on either side (a panel row or a canvas
   *  badge); both sides emphasise whatever matches it. */
  const [hotMark, setHotMark] = useState<HotMark | null>(null);
  /** Region hovered in the link menu's Region list, outlined on the canvas. */
  const [linkHotRegion, setLinkHotRegion] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Drawers: new page, new dataset, and the delete confirmation.
  const [pageDraft, setPageDraft] = useState<{ name: string } | null>(null);
  const [datasetDraft, setDatasetDraft] = useState<{
    sel: ElementSel;
    fieldKey: string;
    name: string;
    kind: DataKind;
    values: string;
  } | null>(null);
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

  // Reusable datasets (platform defaults + this project's own): elements bind
  // to them by id, so the same list feeds the canvas and the inspector.
  const datasetsLoad = useLoad(() => listDatasets(projectId), [projectId]);
  const datasets = datasetsLoad.data ?? [];
  // A failed listing must not be silent: bindings would quietly render as
  // custom values and creation would fail with no context.
  useEffect(() => {
    if (datasetsLoad.error) setNotice(`Datasets unavailable: ${datasetsLoad.error}`);
  }, [datasetsLoad.error]);

  // Developer annotations (notes + tasks): REST state loaded beside the
  // datasets — pinned to document nodes but never part of ops/undo.
  const annotationsLoad = useLoad(() => listWireframeAnnotations(projectId, wireframeId), [projectId, wireframeId]);
  const annotations = useMemo(() => annotationsLoad.data ?? [], [annotationsLoad.data]);

  useEffect(() => {
    setCustomComponents(project.custom_components as CustomDef[]);
  }, [project.custom_components]);

  // The open page: the outgoing one stays rendered while the next loads, so
  // switching pages never blanks the canvas (see usePageDocument).
  const fetchPage = useLivePages(projectId, wireframeId);
  const doc = usePageDocument(fetchPage, activePageId, {
    onArrive: (raw, normalised) => {
      const legacy = isLegacyDocument(raw.document);
      setPendingReset(legacy && canWrite ? { pageId: normalised.id, root: normalised.document.root } : null);
      const migrationOps = !legacy && canWrite ? diffPage(raw, normalised) : [];
      setPendingMigrate(migrationOps.length ? { pageId: normalised.id, ops: migrationOps } : null);
    },
    onError: setNotice,
  });
  const { page, setPage, pendingPageId } = doc;

  // First visit (and after the open page is deleted): land on the pinned
  // landing page, else the first page the shell's nav links to, else the
  // first page. Keeps the fetched shell document for the switcher's
  // nav-order below, and seeds the page cache — the shell is almost always
  // the first host chain's outermost level.
  const pinnedLandingId = wireframe.data?.landing_page_id ?? null;
  const landingDoc = useNavLanding(fetchPage, pages, activePageId, nav.visit, pinnedLandingId, doc.cache);

  // Leaving a page abandons its selection, and a different page's document
  // arriving drops any pick made against the outgoing copy mid-switch. (A
  // cached paint and its revalidation share ids, so a selection made between
  // them survives — the ids still resolve.)
  useEffect(() => {
    setSelection(null);
    setEditingElement(null);
  }, [activePageId, page?.id]);

  // Ancestor shells for a child page: walk placements upwards. The chain
  // holds live PageRecords — shells are edited in place, so their state must
  // accept edits, outbox ACKs and conflict reloads like the open page's.
  // Sharing the page cache lets sibling switches rebuild the chain without
  // refetching (usually without a repaint at all).
  const hostChain = useHostChain(fetchPage, page, doc.cache);
  const host = hostChain.levels;
  const { update: updateHostPage } = hostChain;

  /** Route a page update to whoever holds that page on screen: the open
   *  page's state or an ancestor shell's record. Unknown ids are ignored. */
  const applyPage = useCallback(
    (pageId: string, update: (prev: PageRecord) => PageRecord) => {
      setPage((prev) => (prev && prev.id === pageId ? update(prev) : prev));
      updateHostPage(pageId, update);
    },
    [setPage, updateHostPage],
  );

  const sync = useWireframeSync(projectId, wireframeId, page, applyPage);
  // Unlocking happens above the studio (the banner in ProjectLayout), but the
  // outbox outlives that reload: without this its queue would stay paused for
  // the rest of the session, holding edits it could now send.
  useEffect(() => {
    if (canWrite && sync.snapshot.locked) sync.resume();
  }, [canWrite, sync]);
  /** The page on screen is the one the user asked for and its server copy
   *  has landed. Mid-switch the canvas shows a stale or cached copy the
   *  fetch is about to replace, so every mutation gates on this — an edit
   *  against a doomed copy would silently diverge from what arrives. */
  const pageSettled = !!page && page.id === activePageId && pendingPageId === null;
  /** Settled + any load-time migration/reset already sent, so a cross-page
   *  undo lands on the same normalised form its snapshot used. */
  const pageReady =
    pageSettled &&
    (!pendingReset || pendingReset.pageId !== page?.id) &&
    (!pendingMigrate || pendingMigrate.pageId !== page?.id);
  const pageExists = useCallback((id: string) => pages.some((p) => p.id === id), [pages]);
  const history = usePageHistory(page, sync, {
    ready: pageReady,
    reset: sync.reset,
    pageExists,
    getRecord: (id) => (page?.id === id ? page : hostChain.records.find((r) => r.id === id) ?? null),
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

  // The switcher mirrors the shell's nav bars: pages they link to list in
  // draw order. The shell is the wireframe's first page; prefer the copy
  // being edited (open, or fetched as an ancestor of the open page) over the
  // landing fetch's mount-time snapshot.
  const rootId = pages[0]?.id ?? null;
  const shellDoc =
    (page && page.id === rootId ? page.document : null) ?? host.find((h) => h.pageId === rootId)?.doc ?? landingDoc;
  const orderedPages = useMemo(
    () => orderPagesByNav(pages, shellDoc ? navLinkedPageIds(shellDoc) : []),
    [pages, shellDoc],
  );

  // What the switcher marks as "opens first": the pinned page while it still
  // exists, else what the nav decides (mirroring useNavLanding's fallbacks).
  const landingPinned = !!pinnedLandingId && pages.some((p) => p.id === pinnedLandingId);
  const landingId = landingPinned
    ? pinnedLandingId
    : (shellDoc && firstNavTarget(shellDoc, pages)) || (pages[0]?.id ?? null);

  const setLanding = useCallback(
    (id: string | null) => {
      updateWireframe(projectId, wireframeId, { landing_page_id: id })
        .then(() => wireframe.reload())
        .catch((err) => setNotice(errorMessage(err)));
    },
    [projectId, wireframeId, wireframe],
  );

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

  /** Every editable record on the canvas: the open page, then its shells. */
  const editableRecords = useCallback(
    (): PageRecord[] => (page ? [page, ...hostChain.records] : [...hostChain.records]),
    [page, hostChain.records],
  );
  /** The page that owns a component / a layout node — ids are page-unique
   *  uids, so the first document holding one is its home. */
  const recordOfCmp = useCallback(
    (cmpId: string): PageRecord | null => editableRecords().find((r) => locateCmp(r.document, cmpId)) ?? null,
    [editableRecords],
  );
  const recordOfNode = useCallback(
    (nodeId: string): PageRecord | null => editableRecords().find((r) => findNode(r.document.root, nodeId)) ?? null,
    [editableRecords],
  );

  /** Run an action through history against one page — the open page or an
   *  ancestor shell — apply its UI hints and hand it back so callers can
   *  chain on what was created (e.g. a nav item's page). */
  const runOn = useCallback(
    (
      record: PageRecord | null,
      fn: (draft: PageLike, ctx: ActionContext) => ActionResult | void,
      coalesceKey?: string,
    ): ActionResult | void => {
      // Every mutation funnels through here; none may land while the open
      // page is mid-switch (see pageSettled above).
      if (!canWrite || !record || !pageSettled) return;
      const result = history.commitOn(record, (draft) => fn(draft, ctx), { coalesceKey });
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
    [canWrite, pageSettled, history, ctx, toast, persistDefs, customComponents],
  );
  /** Run against the open page (page-level fields, or a known-local target). */
  const run = useCallback(
    (fn: (draft: PageLike, ctx: ActionContext) => ActionResult | void, coalesceKey?: string) => runOn(page, fn, coalesceKey),
    [runOn, page],
  );
  /** Run against whichever page owns the component / layout node. */
  const runCmp = useCallback(
    (cmpId: string, fn: (draft: PageLike, ctx: ActionContext) => ActionResult | void, coalesceKey?: string) =>
      runOn(recordOfCmp(cmpId), fn, coalesceKey),
    [runOn, recordOfCmp],
  );
  const runNode = useCallback(
    (nodeId: string, fn: (draft: PageLike, ctx: ActionContext) => ActionResult | void, coalesceKey?: string) =>
      runOn(recordOfNode(nodeId), fn, coalesceKey),
    [runOn, recordOfNode],
  );

  const selectedCmpId = selection?.kind === "cmp" ? selection.id : selection?.kind === "element" ? selection.cmpId : null;
  const selectedCmpRecord = selectedCmpId ? recordOfCmp(selectedCmpId) : null;
  const selectedCmpLoc = selectedCmpRecord && selectedCmpId ? locateCmp(selectedCmpRecord.document, selectedCmpId) : null;
  const selectedCmp = selectedCmpLoc ? selectedCmpLoc.list[selectedCmpLoc.index] : null;
  const selectedCmpType = selectedCmp?.type ?? null;

  /** Where a library click lands: the selected region, the selected component's region, else the first region. */
  const targetRegionId = (): string | null => {
    if (!page) return null;
    if (selection?.kind === "region") return selection.id;
    return selectedCmpLoc?.region ?? null;
  };

  // ── Clipboard ─────────────────────────────────────────────────────────────

  const takeSnapshot = useCallback(
    (item: ClipboardItem) => {
      // localStorage-backed, so the copy can be pasted into another
      // wireframe or another tab (see model/clipboard.ts).
      storeClipboard(item, { projectId, wireframeId });
      toast(`Copied "${item.label}" — paste with Ctrl/⌘+V`);
    },
    [toast, projectId, wireframeId],
  );

  /** Copy one component by id (the hover toolbar's Copy button). */
  const copyCmp = useCallback(
    (id: string) => {
      const rec = recordOfCmp(id);
      const loc = rec ? locateCmp(rec.document, id) : null;
      if (loc) takeSnapshot(copyComponentItem(loc.list[loc.index]));
    },
    [recordOfCmp, takeSnapshot],
  );

  /** Snapshot the selected component or element. Returns what was copied —
   *  null (a region, a scalar token, nothing) leaves the clipboard alone. */
  const copySelection = useCallback((): ClipboardItem | null => {
    if (!selection || selection.kind === "region") return null;
    const cmpId = selection.kind === "cmp" ? selection.id : selection.cmpId;
    const rec = recordOfCmp(cmpId);
    const loc = rec ? locateCmp(rec.document, cmpId) : null;
    if (!loc) return null;
    const cmp = loc.list[loc.index];
    const item =
      selection.kind === "cmp"
        ? copyComponentItem(cmp)
        : isElKey(selection.key)
          ? copyElementItem(cmp, selection.key.slice(EL_PREFIX.length))
          : null;
    if (item) takeSnapshot(item);
    return item;
  }, [selection, recordOfCmp, takeSnapshot]);

  const cutSelection = useCallback((): boolean => {
    if (!canWrite || !selection || !copySelection()) return false;
    if (selection.kind === "cmp") runCmp(selection.id, (d, c) => A.removeComponent(d, c, selection.id));
    else if (selection.kind === "element" && isElKey(selection.key)) {
      runCmp(selection.cmpId, (d, c) => A.removeElement(d, c, selection.cmpId, selection.key.slice(EL_PREFIX.length)));
    }
    return true;
  }, [canWrite, selection, copySelection, runCmp]);

  /** Paste: a component lands after the selected component (in that
   *  component's page), in the selected region (wherever it lives), or at
   *  the end of the open page's first region; an element needs a selected
   *  component to land in. Returns whether there was anything to paste. */
  const pasteClipboard = useCallback((): boolean => {
    if (!page || !canWrite) return false;
    const stored = readClipboard();
    if (!stored) return false;
    const { item } = stored;
    // A copy made in another wireframe loses its page links on paste.
    const scope = { sameWireframe: stored.wireframeId === wireframeId };
    if (item.kind === "cmp") {
      const rec = selectedCmpId ? recordOfCmp(selectedCmpId) : null;
      const loc = rec && selectedCmpId ? locateCmp(rec.document, selectedCmpId) : null;
      const regionId = selection?.kind === "region" ? selection.id : (loc?.region ?? null);
      const target = regionId ? recordOfNode(regionId) : page;
      runOn(target, (d, c) => pasteComponent(d, c, item, regionId, loc ? loc.index + 1 : null, scope));
    } else if (selectedCmpId) {
      runCmp(selectedCmpId, (d, c) => pasteElement(d, c, selectedCmpId, item, scope));
    } else {
      toast("Select a component to paste the copied element into");
    }
    return true;
  }, [page, canWrite, selection, selectedCmpId, recordOfCmp, recordOfNode, runOn, runCmp, toast, wireframeId]);

  /** Move a component between two pages on the canvas (a drag from the open
   *  page into an ancestor shell's region, or the reverse): a paste-style
   *  insert into the destination — ids reminted, links kept — then the
   *  original is removed. Two commits, one per page, so each page's ops stay
   *  self-contained; undo reverses them one step at a time. */
  const moveAcross = (
    srcId: string,
    srcRec: PageRecord,
    dstRec: PageRecord,
    place: (dstDoc: typeof dstRec.document) => { regionId: string | null; index: number | null },
  ) => {
    const loc = locateCmp(srcRec.document, srcId);
    if (!loc) return;
    const item = copyComponentItem(loc.list[loc.index]);
    const { regionId, index } = place(dstRec.document);
    runOn(srcRec, (d, c) => A.removeComponent(d, c, srcId));
    runOn(dstRec, (d, c) => pasteComponent(d, c, item, regionId, index, { sameWireframe: true }));
  };

  // Clicking dead space outside the canvas — the inspector background, the
  // topbar — clears the selection, mirroring the gutter click inside the
  // canvas. Exempt: the canvas itself (it owns its own deselect above),
  // every control and its `.field` row (changing a property must never
  // deselect), the library bars (deselecting would hide the element bar
  // mid-pick), and the page picker. NOTE: a new clickable div outside the
  // canvas needs its class added here, or its click will clear the
  // selection it just set.
  const outsideDeadSpace = (target: HTMLElement) =>
    !target.closest(
      ".canvas-wrap, button, input, select, textarea, label, a, [contenteditable='true'], [role='button'], .field, .lib-bar, .page-select, .toast, .notes-panel, .panel-tabs",
    );
  /** Whether the current press started on dead space (see the root onClick). */
  const pressOnDeadSpace = useRef(false);
  /** The mat, measured to scale a framed device into it (see stage.tsx). */
  const canvasWrap = useRef<HTMLDivElement>(null);

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
        if (!pageSettled) return;
        if (key === "y" || e.shiftKey) history.redo();
        else history.undo();
        e.preventDefault();
        return;
      }
      // Every other shortcut defers to whatever control holds focus.
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable) return;
      if (mod && e.key.toLowerCase() === "i") { setRightCollapsed((v) => !v); e.preventDefault(); }
      else if (mod && !e.altKey && !e.shiftKey && (key === "c" || key === "x" || key === "v")) {
        // Copy/cut/paste the selected component or element. A live text
        // selection on the page keeps the browser's own copy/cut.
        if (key === "v") {
          if (canWrite && pasteClipboard()) e.preventDefault();
        } else if (window.getSelection()?.isCollapsed !== false) {
          if (key === "c" ? !!copySelection() : cutSelection()) e.preventDefault();
        }
      }
      else if ((e.key === "Enter" || e.key === "F2") && selection?.kind === "element" && canWrite) {
        setEditingElement(selection);
        e.preventDefault();
      } else if ((e.key === "Delete" || e.key === "Backspace") && selection?.kind === "element" && isElKey(selection.key) && canWrite) {
        runCmp(selection.cmpId, (d, c) => A.removeElement(d, c, selection.cmpId, selection.key.slice(EL_PREFIX.length)));
        e.preventDefault();
      } else if (e.key.toLowerCase() === "p" && !mod && !e.altKey && selection) {
        // Step the selection up one level: element → its component → its
        // region. The only way to reach a region a full-bleed component covers.
        if (selection.kind === "element") {
          setSelection({ kind: "cmp", id: selection.cmpId });
          setEditingElement(null);
          e.preventDefault();
        } else if (selection.kind === "cmp") {
          const rec = recordOfCmp(selection.id);
          const region = rec ? locateCmp(rec.document, selection.id)?.region : undefined;
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
  }, [history, dialogOpen, selection, canWrite, pageSettled, runCmp, recordOfCmp, copySelection, cutSelection, pasteClipboard]);

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
    doc.evict(pendingDelete.id);
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

  // ── Datasets ──────────────────────────────────────────────────────────────

  /** Open the new-dataset drawer, seeded from the element's label, data kind
   *  and current manual values (the samples/options the dataset replaces). */
  const openCreateDataset = (sel: ElementSel, fieldKey: string) => {
    const rec = recordOfCmp(sel.cmpId);
    const loc = rec ? locateCmp(rec.document, sel.cmpId) : null;
    const node = loc ? loc.list[loc.index] : null;
    const element = node && isElKey(sel.key) ? findElement(node, sel.key.slice(EL_PREFIX.length)) : null;
    const meta = node && element ? elementMeta(node.type, element.type) : null;
    const manualKey = meta?.dataFields.find((f) => f.key === fieldKey)?.supersedes;
    const manual = (manualKey && element?.data?.[manualKey]) || "";
    const kind = element?.data?.kind ?? "";
    setDatasetDraft({
      sel,
      fieldKey,
      name: element?.label.trim() || "New dataset",
      kind: (DATA_KINDS as readonly string[]).includes(kind) ? (kind as DataKind) : "text",
      values: manual.split(",").map((v) => v.trim()).filter(Boolean).join("\n"),
    });
  };

  const submitDataset = async (e: FormEvent) => {
    e.preventDefault();
    if (!datasetDraft || !datasetDraft.name.trim()) return;
    setBusy(true);
    try {
      const created = await createDataset(projectId, {
        name: datasetDraft.name.trim(),
        kind: datasetDraft.kind,
        values: datasetDraft.values.split("\n").map((v) => v.trim()).filter(Boolean),
      });
      await datasetsLoad.reload();
      const { sel, fieldKey } = datasetDraft;
      if (isElKey(sel.key)) {
        runCmp(sel.cmpId, (d, c) => A.setElementData(d, c, sel.cmpId, sel.key.slice(EL_PREFIX.length), fieldKey, created.id));
      }
      setDatasetDraft(null);
      toast(`Created dataset "${created.name}"`);
    } catch (err) {
      setNotice(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const updateDatasetValues = (id: string, values: string[]) => {
    updateDataset(projectId, id, { values })
      .then(() => datasetsLoad.reload())
      .catch((err) => setNotice(errorMessage(err)));
  };

  /** Delete a project dataset and unbind the element it was edited from;
   *  other elements referencing it fall back to their own sample values. */
  const removeDataset = (sel: ElementSel, fieldKey: string, id: string) => {
    const ds = datasets.find((d2) => d2.id === id);
    if (!window.confirm(`Delete dataset "${ds?.name ?? ""}"? Elements using it go back to their own sample values.`)) return;
    deleteDataset(projectId, id)
      .then(() => {
        if (isElKey(sel.key)) {
          runCmp(sel.cmpId, (d, c) => A.setElementData(d, c, sel.cmpId, sel.key.slice(EL_PREFIX.length), fieldKey, ""));
        }
        return datasetsLoad.reload();
      })
      .catch((err) => setNotice(errorMessage(err)));
  };

  // ── Links ─────────────────────────────────────────────────────────────────

  // The Region list the link menu offers: every document on the canvas in
  // visual order — the ancestor shells outermost first, then the open page —
  // so an element on a child page can still target the shell region the user
  // sees around it (the outlet model).
  const linkRegions = useMemo(() => {
    const levels: ComposedLevel[] = hostChain.records.map((r, i) => ({
      doc: r.document,
      pageId: r.id,
      name: r.name,
      outletRegionId: host[i]?.regionId ?? null,
    }));
    if (page) levels.push({ doc: page.document, pageId: page.id, name: page.name, outletRegionId: null });
    return composeRegionOptions(levels);
  }, [hostChain.records, host, page]);

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

  /** Setting a link takes you to what you linked. The target's document is
   *  not loaded yet (a fresh page, or one only ever seen in the page list),
   *  so the landing region resolves in the reveal effect once it arrives. */
  const openLinkedPage = useCallback(
    (pageId: string) => {
      nav.visit(pageId);
      setPendingReveal({ pageId, sel: null });
    },
    [nav.visit], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const createLinkedPage = async (sel: ElementSel, regionId: string | null, nameOverride?: string, presentation?: PagePresentation) => {
    // Settled only: the link-back edit below would be dropped mid-switch,
    // leaving an orphaned page behind.
    if (!page || busy || !pageSettled) return;
    // The element may sit on an ancestor shell, and the chosen region may
    // belong to any document on the canvas: the created page is placed in
    // the page that owns THAT REGION, while the name is seeded from the
    // element's own page.
    const owner = recordOfCmp(sel.cmpId) ?? page;
    const regionOwner = (regionId ? recordOfNode(regionId) : null) ?? owner;
    const ownerCmpLoc = locateCmp(owner.document, sel.cmpId);
    const ownerCmp = ownerCmpLoc ? ownerCmpLoc.list[ownerCmpLoc.index] : null;
    const seed = nameOverride ?? (ownerCmp ? elementValue(ownerCmp, sel.key, sel.index) : "");
    const name = seed.trim() || (presentation === "modal" ? "New modal" : presentation ? "New drawer" : "New page");
    setBusy(true);
    try {
      const created = await createWireframePage(projectId, wireframeId, {
        name,
        route: slugOf(name),
        pos: posAfterLast(pages),
        // An overlay is placed on the owner page too: the placement parent is
        // the backdrop it renders over, and the region is a sane landing spot
        // if it is ever converted back to an ordinary page.
        placement: regionId
          ? { page_id: regionOwner.id, region_id: regionId }
          : presentation
            ? { page_id: owner.id, region_id: fallbackRegionId(owner.document.root) }
            : undefined,
        presentation,
        // The page arrives with its region already named after the route that
        // reaches it — "Users > Edit" — rather than the server's blank default.
        document: blankDocument(linkedRegionLabel(ownerCmp, seed)),
      });
      await wireframe.reload();
      // Link first, then open: every mutation gates on the open page being
      // settled, so navigating a line earlier would drop the link edit. The
      // batch is already queued, and the outbox sends per page, not per open
      // page, so leaving the owner page cannot strand it.
      runCmp(sel.cmpId, (d, c) => A.setElementLink(d, c, sel.cmpId, sel.key, sel.index, { pageId: created.id }));
      openLinkedPage(created.id);
      toast(
        presentation
          ? `Created ${presentation} "${name}"`
          : regionId
            ? `Created "${name}" inside ${regionDisplayName(regionOwner.document.root, regionId)}`
            : `Created page "${name}"`,
      );
    } catch (err) {
      setNotice(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  /** The CRUD recipe: one click turns a list into a working prototype — Edit
   *  and Archive row actions, a status filter, and a drawer whose form mirrors
   *  the list's own columns.
   *
   *  Two writes, in this order. The drawer arrives complete from a single POST
   *  (a page is created with its whole document, so its form needs no ops of
   *  its own), and then ONE commit adds the actions, the filter and the Edit
   *  link to the list — a single op batch and a single undo step. As with every
   *  page, the created drawer sits outside the history timeline, so undo
   *  unwires the list but leaves the page; the toast says what was made.
   *
   *  Archiving is reversible, so it gets no confirmation page and no link at
   *  all. An @back link would navigate away from the very list the row was
   *  archived in, misrepresenting an action that acts in place.
   *
   *  Re-running is additive but never duplicating — see crudGaps. */
  const runCrudRecipe = async (cmpId: string) => {
    if (!page || busy || !pageSettled) return;
    // The list may sit on an ancestor shell, so the drawer is placed on
    // whichever page actually owns it.
    const owner = recordOfCmp(cmpId) ?? page;
    const loc = locateCmp(owner.document, cmpId);
    const listCmp = loc ? loc.list[loc.index] : null;
    if (!listCmp || crudDisabledReason(listCmp)) return;

    const gaps = crudGaps(listCmp);
    if (!gaps.edit && !gaps.archive && !gaps.filter) {
      toast("This list already has its CRUD actions");
      return;
    }
    const name = editPageName(listCmp);
    setBusy(true);
    try {
      let editPageId: string | null = null;
      if (gaps.edit) {
        const created = await createWireframePage(projectId, wireframeId, {
          name,
          route: slugOf(name),
          pos: posAfterLast(pages),
          // The drawer opens over the page holding the list, the same way an
          // overlay created from the link picker is placed on its backdrop.
          placement: { page_id: owner.id, region_id: fallbackRegionId(owner.document.root) },
          presentation: "drawer",
          document: buildEditDocument(listCmp, linkedRegionLabel(listCmp, EDIT_ACTION_LABEL)),
        });
        editPageId = created.id;
        await wireframe.reload();
      }

      // One commit for the whole recipe, so it undoes as a single step.
      // commitOn rebases onto the live record, so the await above cannot make
      // this send a stale document back to the server.
      runCmp(cmpId, (d, c) => {
        if (gaps.edit) {
          const added = A.addElement(d, c, cmpId, { type: "row-action", label: EDIT_ACTION_LABEL });
          const key = added?.selectElement?.key;
          if (key && editPageId) A.setElementLink(d, c, cmpId, key, null, { pageId: editPageId });
        }
        if (gaps.archive) A.addElement(d, c, cmpId, { type: "row-action", label: ARCHIVE_ACTION_LABEL });
        if (gaps.filter) {
          // Bind the seeded platform dataset when it is still there; a platform
          // admin can delete it, so fall back to the same values inline.
          const bound = datasets.some((ds) => ds.id === RECORD_STATUS_DATASET_ID);
          A.addElement(d, c, cmpId, {
            type: "filter",
            label: FILTER_LABEL,
            data: bound
              ? { dataset: RECORD_STATUS_DATASET_ID, selected: FILTER_DEFAULT }
              : { options: FILTER_FALLBACK_OPTIONS, selected: FILTER_DEFAULT },
          });
        }
        // Keep the list selected: the element bar follows the selection, and
        // the user is most likely to keep working on the list they just built.
        return { selectCmpId: cmpId };
      });
      // Staying put is deliberate — the point is to see what was built.
      toast(gaps.edit ? `Added CRUD actions and the "${name}" drawer` : "Added the missing CRUD parts");
    } catch (err) {
      setNotice(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  /** Rename a page that is NOT open in the editor: the op outbox only serves
   *  the open page, so this sends one direct batch, then refreshes the list.
   *  `relabel` also moves the region auto-named after the element, which is
   *  carried as a whole-tree set — the only op shape that reaches a label. */
  const renameLinkedPage = async (
    pageId: string,
    name: string,
    relabel?: { cmp: ComponentNode | null; before: string },
  ) => {
    try {
      const target = await getWireframePage(projectId, wireframeId, pageId);
      const ops: Op[] = [
        { op: "set", path: "name", value: name },
        { op: "set", path: "route", value: slugOf(name) },
      ];
      if (relabel) {
        const next = structuredClone(target.document) as PageDocument;
        if (relabelLinkedRegion(next, relabel.cmp, relabel.before, name)) {
          ops.push({ op: "set", path: "root", value: next.root });
        }
      }
      await sendWireframeOpBatch(projectId, wireframeId, {
        clientBatchId: defaultBatchId(),
        pageId,
        baseVersion: target.version,
        ops,
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
    // Settled only: the text edit below routes through runOn's gate anyway,
    // but the follow-on page rename must not fire when that edit is dropped.
    if (!pageSettled) return;
    const owner = recordOfCmp(sel.cmpId);
    const loc = owner ? locateCmp(owner.document, sel.cmpId) : null;
    const cmp = loc ? loc.list[loc.index] : null;
    const before = cmp ? elementValue(cmp, sel.key, sel.index) : "";
    const link = cmp ? elementLink(cmp, sel.key, sel.index) : null;
    const name = (text || "").trim();
    const targetName =
      link && link.pageId !== BACK_PAGE_ID
        ? link.pageId === owner?.id
          ? owner.name
          : pages.find((p) => p.id === link.pageId)?.name
        : undefined;
    const follow = !!link && !!name && name !== before && targetName === before;
    if (follow && link && owner && link.pageId === owner.id) {
      // The element links to its own page: one commit, one undo step.
      runOn(owner, (d, c) => {
        const result = A.setElementText(d, c, sel.cmpId, sel.key, sel.index, text);
        d.name = name;
        d.route = slugOf(name);
        relabelLinkedRegion(d.document, cmp, before, name);
        return result;
      });
      void wireframe.reload();
      return;
    }
    runCmp(sel.cmpId, (d, c) => A.setElementText(d, c, sel.cmpId, sel.key, sel.index, text));
    if (follow && link) {
      // A rename of a page that is on screen (the open page, or another
      // shell) goes through the routed commit; anything else is sent as a
      // one-off batch by renameLinkedPage.
      const target = page?.id === link.pageId ? page : hostChain.records.find((r) => r.id === link.pageId) ?? null;
      if (target) {
        runOn(target, (d) => {
          d.name = name;
          d.route = slugOf(name);
          relabelLinkedRegion(d.document, cmp, before, name);
        });
        void wireframe.reload();
      } else {
        void renameLinkedPage(link.pageId, name, { cmp, before });
      }
    }
  };

  /** Add an element. A nav item added to a nav bar also gets a page of its
   *  own, placed in the content region that nav bar serves — its immediate
   *  child region on the page that owns the nav bar (see contentRegionFor). */
  const addElementTo = (cmpId: string, type: string) => {
    const owner = recordOfCmp(cmpId);
    const loc = owner ? locateCmp(owner.document, cmpId) : null;
    const hostCmp = loc ? loc.list[loc.index] : null;
    const result = runCmp(cmpId, (d, c) => A.addElement(d, c, cmpId, type));
    const created = result?.selectElement;
    if (!created || !owner || !loc || hostCmp?.type !== "navbar" || type !== "nav-item") return;
    const regionId = contentRegionFor(owner.document.root, loc.region);
    if (!regionId) return;
    void createLinkedPage(created, regionId, elementMeta("navbar", "nav-item")?.defaultLabel ?? "Item");
  };

  // ── Builder ───────────────────────────────────────────────────────────────

  const openBuilderFor = (cmpId: string) => {
    const rec = recordOfCmp(cmpId);
    const loc = rec && locateCmp(rec.document, cmpId);
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
    runCmp(cmpId, (d) => {
      const loc2 = locateCmp(d.document, cmpId);
      if (loc2) loc2.list[loc2.index].customId = created.id;
      return { newDef: created };
    });
    setBuilder({ open: true, defId: created.id });
  };

  // Plain function, not useCallback: commitElementText/addElementTo close
  // over the current page and pages, so memoising on `run` alone would hand
  // the canvas stale closures. Everything routes by the component's id, so
  // a shell component's edits land on the page that owns it.
  /** Capture where each component in a region currently renders, so
   *  switching the region to free layout keeps everything exactly where it
   *  sits. Foreign ids (an outlet's child-page components) are handed over
   *  too; the action ignores any id not in the region's own list. */
  const measureFreeStamps = (regionId: string): A.FreeStamp[] => {
    const region = document.querySelector(`[data-region-id="${CSS.escape(regionId)}"]`);
    const body = region?.querySelector(":scope > .rg-body") as HTMLElement | null;
    if (!body) return [];
    const bodyRect = body.getBoundingClientRect();
    // Rects are screen pixels, which a fitted stage shrinks; positions and
    // sizes are stored in the device's own pixels (see stage.tsx).
    const scale = stageScale(body);
    const stamps: A.FreeStamp[] = [];
    body.querySelectorAll<HTMLElement>("[data-cmp-id]").forEach((el) => {
      const r = el.getBoundingClientRect();
      stamps.push({
        id: el.dataset.cmpId ?? "",
        x: (r.left - bodyRect.left) / scale + body.scrollLeft,
        y: (r.top - bodyRect.top) / scale + body.scrollTop,
        w: el.offsetWidth,
        h: el.offsetHeight,
      });
    });
    return stamps;
  };

  /** Capture where one component currently renders inside its region body,
   *  so floating it lifts it exactly where it sits. */
  const measureCmpStamp = (cmpId: string): A.FreeStamp | null => {
    const el = document.querySelector<HTMLElement>(`.cmp[data-cmp-id="${CSS.escape(cmpId)}"]`);
    const body = el?.closest(".rg-body") as HTMLElement | null;
    if (!el || !body) return null;
    const bodyRect = body.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const scale = stageScale(body);
    return {
      id: cmpId,
      x: (r.left - bodyRect.left) / scale + body.scrollLeft,
      y: (r.top - bodyRect.top) / scale + body.scrollTop,
      w: el.offsetWidth,
      h: el.offsetHeight,
    };
  };

  const editFor = (id: string): SchematicEdit => ({
    setPropValue: (key, text) => runCmp(id, (d, c) => A.setPropValue(d, c, id, key, text)),
    setElementLabel: (elId, text) => commitElementText({ cmpId: id, key: elKey(elId), index: null }, text),
    setElementData: (elId, key, value) => runCmp(id, (d, c) => A.setElementData(d, c, id, elId, key, value)),
    addElement: (type) => addElementTo(id, type),
    removeElement: (elId) => runCmp(id, (d, c) => A.removeElement(d, c, id, elId)),
    addRow: () => runCmp(id, (d, c) => A.addListRow(d, c, id)),
    setListCell: (row, columnId, text) => runCmp(id, (d, c) => A.setListCell(d, c, id, row, columnId, text)),
    // One commit for the whole batch: a multi-selection drag undoes as one.
    moveElementsTo: (moves) =>
      runCmp(id, (d, c) => {
        for (const m of moves) A.setElementPosition(d, c, id, m.id, m.x, m.y);
      }),
    resizeElementTo: (elId, w, h) => runCmp(id, (d, c) => A.setElementSize(d, c, id, elId, w, h)),
    reorderElement: (srcId, targetId, before) => runCmp(id, (d, c) => A.reorderElement(d, c, id, srcId, targetId, before)),
  });

  /** The open page plus its ancestor shells: a nav item linking to any of
   *  these renders as the current tab (see SchematicChrome.activePageIds). */
  const activePageIds = useMemo(
    () => (page ? [page.id, ...host.map((h) => h.pageId)] : []),
    [page?.id, host], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // ── Annotations (notes + tasks) ───────────────────────────────────────────

  const noteItems = useMemo(() => annotations.filter((a) => a.kind === "note"), [annotations]);
  const taskItems = useMemo(() => annotations.filter((a) => a.kind === "task"), [annotations]);
  const openTaskCount = useMemo(() => taskItems.filter((t) => !t.resolved_at).length, [taskItems]);

  /** What the composer would pin a new annotation to. A scalar-prop selection
   *  (a heading token) falls back to its component — the label shows that. */
  const composerTarget = useMemo((): ComposerTarget | null => {
    if (!selection) return null;
    if (selection.kind === "region") {
      const rec = recordOfNode(selection.id);
      return rec
        ? {
            pageId: rec.id,
            kind: "region",
            targetId: selection.id,
            cmpId: null,
            label: `Region · ${regionDisplayName(rec.document.root, selection.id)}`,
          }
        : null;
    }
    const cmpId = selection.kind === "cmp" ? selection.id : selection.cmpId;
    const rec = recordOfCmp(cmpId);
    const loc = rec ? locateCmp(rec.document, cmpId) : null;
    const cmp = loc ? loc.list[loc.index] : null;
    if (!rec || !cmp) return null;
    if (selection.kind === "element" && isElKey(selection.key)) {
      const el = findElement(cmp, selection.key.slice(EL_PREFIX.length));
      if (el) {
        const label = el.label.trim() || elementMeta(cmp.type, el.type)?.label || el.type;
        return { pageId: rec.id, kind: "element", targetId: el.id, cmpId, label: `Element · ${label}` };
      }
    }
    return {
      pageId: rec.id,
      kind: "cmp",
      targetId: cmpId,
      cmpId: null,
      label: `Component · ${cmp.label || COMPONENTS[cmp.type]?.label || cmp.type}`,
    };
  }, [selection, recordOfCmp, recordOfNode]);

  /** Resolve an annotation's target against whatever documents are at hand:
   *  the open page, its shells, or the page cache. Off-canvas pages fall back
   *  to the label snapshotted at creation. */
  const describeTarget = useCallback(
    (a: WireframeAnnotation): TargetInfo => {
      const fallback =
        a.target_label ||
        (a.target_kind === "region" ? "Region" : a.target_kind === "cmp" ? "Component" : "Element");
      if (!pages.some((p) => p.id === a.page_id)) return { state: "orphan", label: fallback };
      const rec =
        (page?.id === a.page_id ? page : null) ??
        hostChain.records.find((r) => r.id === a.page_id) ??
        doc.cache.current.get(a.page_id) ??
        null;
      if (!rec) return { state: "unknown", label: fallback };
      if (a.target_kind === "region") {
        const found = findNode(rec.document.root, a.target_id);
        return found?.node.kind === "region"
          ? { state: "live", label: `Region · ${regionDisplayName(rec.document.root, a.target_id)}` }
          : { state: "orphan", label: fallback };
      }
      const cmpId = a.target_kind === "cmp" ? a.target_id : a.target_cmp_id ?? "";
      const loc = locateCmp(rec.document, cmpId);
      const cmp = loc ? loc.list[loc.index] : null;
      if (!cmp) return { state: "orphan", label: fallback };
      if (a.target_kind === "cmp") {
        return { state: "live", label: `Component · ${cmp.label || COMPONENTS[cmp.type]?.label || cmp.type}` };
      }
      const el = findElement(cmp, a.target_id);
      return el
        ? { state: "live", label: `Element · ${el.label.trim() || elementMeta(cmp.type, el.type)?.label || el.type}` }
        : { state: "orphan", label: fallback };
    },
    [pages, page, hostChain.records, doc.cache],
  );

  /** Canvas markers: annotations on the visible documents only; a resolved
   *  task loses its marker. Ids are page-unique, so flat sets suffice. */
  const annotationMarks = useMemo((): AnnotationMarks => {
    const mk = () => ({ regions: new Set<string>(), cmps: new Set<string>(), els: new Set<string>() });
    const notes = mk();
    const tasks = mk();
    const visible = new Set(activePageIds);
    for (const a of annotations) {
      if (!visible.has(a.page_id)) continue;
      if (a.kind === "task" && a.resolved_at) continue;
      const m = a.kind === "task" ? tasks : notes;
      if (a.target_kind === "region") m.regions.add(a.target_id);
      else if (a.target_kind === "cmp") m.cmps.add(a.target_id);
      else m.els.add(a.target_id);
    }
    return { notes, tasks };
  }, [annotations, activePageIds]);

  const reloadAnnotations = annotationsLoad.reload;

  const createAnnotation = useCallback(
    async (kind: AnnotationKind, text: string) => {
      if (!composerTarget) return;
      try {
        await createWireframeAnnotation(projectId, wireframeId, {
          page_id: composerTarget.pageId,
          kind,
          target_kind: composerTarget.kind,
          target_id: composerTarget.targetId,
          target_cmp_id: composerTarget.kind === "element" ? composerTarget.cmpId : undefined,
          target_label: composerTarget.label,
          text,
        });
        await reloadAnnotations();
      } catch (err) {
        setNotice(errorMessage(err));
      }
    },
    [composerTarget, projectId, wireframeId, reloadAnnotations],
  );

  const patchAnnotation = useCallback(
    (a: WireframeAnnotation, patch: { text?: string; resolved?: boolean }) => {
      updateWireframeAnnotation(projectId, wireframeId, a.id, patch)
        .then(() => reloadAnnotations())
        .catch((err) => setNotice(errorMessage(err)));
    },
    [projectId, wireframeId, reloadAnnotations],
  );

  const removeAnnotation = useCallback(
    (a: WireframeAnnotation) => {
      deleteWireframeAnnotation(projectId, wireframeId, a.id)
        .then(() => reloadAnnotations())
        .catch((err) => setNotice(errorMessage(err)));
    },
    [projectId, wireframeId, reloadAnnotations],
  );

  /** A canvas marker was clicked: select its node and show its annotations. */
  const openAnnotationsFor = useCallback((sel: Selection, kind: "note" | "task") => {
    setSelection(sel);
    setRightTab(kind === "task" ? "tasks" : "notes");
    setRightCollapsed(false);
  }, []);

  // A hovered row or badge can unmount without a mouseleave (tab switch,
  // page switch, delete) — drop the stale highlight rather than leave a
  // marker glowing.
  useEffect(() => {
    setHotMark(null);
  }, [rightTab, activePageId]);

  /** Jump from a list row to its target, switching pages when needed. */
  const jumpToAnnotation = useCallback(
    (a: WireframeAnnotation) => {
      if (!pages.some((p) => p.id === a.page_id)) {
        toast("That page no longer exists");
        return;
      }
      const sel: Selection =
        a.target_kind === "region"
          ? { kind: "region", id: a.target_id }
          : a.target_kind === "cmp"
            ? { kind: "cmp", id: a.target_id }
            : { kind: "element", cmpId: a.target_cmp_id ?? "", key: elKey(a.target_id), index: null };
      if (editableRecords().some((r) => r.id === a.page_id)) {
        if (describeTarget(a).state === "orphan") toast("Target no longer exists");
        else setSelection(sel);
        return;
      }
      nav.visit(a.page_id);
      setPendingReveal({ pageId: a.page_id, sel });
    },
    [pages, toast, editableRecords, describeTarget, nav.visit], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Declared after the selection-clearing effect above, so once the
  // jumped-to page settles this applies the stashed selection last.
  useEffect(() => {
    if (!pendingReveal) return;
    if (!pages.some((p) => p.id === pendingReveal.pageId)) {
      setPendingReveal(null);
      return;
    }
    if (!pageSettled || !page || page.id !== pendingReveal.pageId) return;
    const { sel } = pendingReveal;
    if (!sel) {
      // Arrived from a link: land on the page's main content region, ready
      // to build in it.
      setSelection({ kind: "region", id: fallbackRegionId(page.document.root) });
      setPendingReveal(null);
      return;
    }
    const found =
      sel.kind === "region"
        ? !!findNode(page.document.root, sel.id)
        : sel.kind === "cmp"
          ? !!locateCmp(page.document, sel.id)
          : (() => {
              const loc = locateCmp(page.document, sel.cmpId);
              const cmp = loc ? loc.list[loc.index] : null;
              return !!cmp && !!findElement(cmp, sel.key.slice(EL_PREFIX.length));
            })();
    if (found) setSelection(sel);
    else toast("Target no longer exists");
    setPendingReveal(null);
  }, [pendingReveal, pageSettled, page, pages, toast]);

  // Mobile and tablet wireframes edit inside a device-shaped stage scaled to
  // fit the canvas area; desktop keeps the full-bleed canvas (see stage.tsx
  // and "Device stage" in studio.css). Resolved above the early returns
  // because measuring the stage is a hook.
  const interfaceType = wireframe.data?.interface_type ?? "desktop";
  const stageFit = useStageFit(canvasWrap, interfaceType);

  // Only the cold start blanks the studio: reload() keeps data, so page
  // create/rename/delete refresh the list without unmounting the canvas.
  if (wireframe.loading && !wireframe.data) return <div className="page muted">Loading…</div>;
  if (wireframe.error || !wireframe.data) return <div className="page error">{wireframe.error ?? "Not found"}</div>;

  const builderInitial = builder.defId ? customComponents.find((d) => d.id === builder.defId) ?? null : null;

  const framed = interfaceType !== "desktop";
  const device = deviceClass(interfaceType);
  // Desktop pages widen for their fixed-px columns and the canvas scrolls to
  // them; a framed device keeps its screen width, like the hardware it draws.
  const minDeviceWidth = !framed && page ? deviceMinWidth(page.document, host, page.presentation) : 0;
  // A switch in flight dims the (still rendered) outgoing page after a beat;
  // a fast switch shows nothing at all (see .page-switching in studio.css).
  const pageSwitching = !!page && !pageSettled;

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
        <div className="brand">
          {wireframe.data.name}
          {/* A member edits nothing but may still pin tasks, so say which. */}
          {!canWrite && <span className="v"> · {canAddTasks ? "tasks only" : "read only"}</span>}
        </div>
        {versionCount !== null && <div className="crumbs"><b>v{versionCount}</b></div>}
        {/* The component library fills the bar's spare middle; viewers get a plain spacer. */}
        {canWrite ? (
          <ComponentBar
            canWrite={canWrite}
            onAdd={(type) => {
              // Land in the selected region (which may belong to an ancestor
              // shell); with nothing selected, the open page's first region.
              const regionId = targetRegionId();
              const target = regionId ? recordOfNode(regionId) : page;
              runOn(target, (d, c) => A.appendComponent(d, c, { type }, regionId, null, null));
            }}
          />
        ) : (
          <div className="spacer" />
        )}
        <div className="page-nav">
          <button className="btn ghost" disabled={!nav.canBack} title="Back to previous page" onClick={nav.back}>‹</button>
          <button className="btn ghost" disabled={!nav.canForward} title="Forward to next page" onClick={nav.forward}>›</button>
        </div>
        <PageSelect
          pages={orderedPages}
          activeId={activePageId}
          canWrite={canWrite}
          landingId={landingId}
          landingPinned={landingPinned}
          onSelect={nav.visit}
          onAdd={openAddPage}
          onDelete={removePage}
          onSetLanding={setLanding}
        />
        {canWrite && (
          <>
            <button className="btn ghost" disabled={!history.canUndo || !pageSettled} title="Undo (Ctrl/⌘+Z)" onClick={history.undo}>↶ Undo</button>
            <button className="btn ghost" disabled={!history.canRedo || !pageSettled} title="Redo (Ctrl/⌘+Shift+Z)" onClick={history.redo}>↷ Redo</button>
            <button className="btn ghost" disabled={busy} title="Save a snapshot of this wireframe" onClick={() => void saveVersion()}>Save snapshot</button>
          </>
        )}
      </div>
      {notice && <div className="status-banner warn">{notice} <button className="btn small ghost" onClick={() => setNotice(null)}>Dismiss</button></div>}
      {sync.conflict && <div className="status-banner warn">{sync.conflict}</div>}

      <div className="workspace">
        <div className={`app${rightCollapsed ? " right-collapsed" : ""}`}>
          <section className="panel center">
            <div
              className={`canvas-wrap${framed ? " framed" : ""}`}
              ref={canvasWrap}
              onClick={(e) => {
                // Clicking off — the gutter around the page, or dead space
                // inside it — clears the selection. Anything selectable or
                // interactive handles (or guards) its own clicks.
                if ((e.target as HTMLElement).closest(".cmp, .rg, .rg-toolbar, .split-div")) return;
                setSelection(null);
              }}
            >
              <Stage fit={stageFit}>
              <div className={`device ${device}${pageSwitching ? " page-switching" : ""}`} style={stageFit ? stageFit.device : minDeviceWidth > 0 ? { minWidth: minDeviceWidth } : undefined}>
                {page ? (
                  <Canvas
                    doc={page.document}
                    host={host}
                    presentation={page.presentation}
                    onDismissOverlay={() => {
                      // Back where the trail knows it; a page opened cold
                      // (deep link, page picker) falls back to its backdrop.
                      if (nav.canBack) nav.back();
                      else if (host.length) nav.visit(host[host.length - 1].pageId);
                    }}
                    activePageIds={activePageIds}
                    selection={selection}
                    editingElement={editingElement}
                    defs={customComponents}
                    datasets={datasets}
                    canWrite={canWrite}
                    marks={annotationMarks}
                    onMarkClick={openAnnotationsFor}
                    hotMark={hotMark}
                    onMarkHover={setHotMark}
                    linkHotRegion={linkHotRegion}
                    onSelect={setSelection}
                    editFor={editFor}
                    onEditEnd={() => setEditingElement(null)}
                    onFollow={followLink}
                    onMove={(id, delta) => runCmp(id, (d, c) => A.moveComponent(d, c, id, delta))}
                    onCopy={copyCmp}
                    onRemove={(id) => runCmp(id, (d, c) => A.removeComponent(d, c, id))}
                    onEditStructure={openBuilderFor}
                    onDropPattern={(id, regionId) => runNode(regionId, (d, c) => A.applyPattern(d, c, id, regionId))}
                    onDropComponent={(type, customId, regionId, index, shapeId, at) =>
                      runNode(regionId, (d, c) => A.appendComponent(d, c, { type, shape: shapeId }, regionId, index, customId ?? null, at ?? null))
                    }
                    onDropElement={(type, cmpId) => addElementTo(cmpId, type)}
                    onReorder={(src, target, before) => {
                      const srcRec = recordOfCmp(src);
                      const dstRec = recordOfCmp(target);
                      if (!srcRec || !dstRec) return;
                      if (srcRec.id === dstRec.id) {
                        runOn(srcRec, (d, c) => A.reorderById(d, c, src, target, before));
                        return;
                      }
                      // Dragged across shell levels: land beside the target
                      // on ITS page.
                      moveAcross(src, srcRec, dstRec, (dstDoc) => {
                        const loc = locateCmp(dstDoc, target);
                        return loc
                          ? { regionId: loc.region, index: before ? loc.index : loc.index + 1 }
                          : { regionId: null, index: null };
                      });
                    }}
                    onMoveToRegion={(src, regionId, at) => {
                      const srcRec = recordOfCmp(src);
                      const dstRec = recordOfNode(regionId);
                      if (!srcRec || !dstRec) return;
                      if (srcRec.id === dstRec.id) {
                        runOn(srcRec, (d, c) => A.moveToRegion(d, c, src, regionId, at ?? null));
                        return;
                      }
                      moveAcross(src, srcRec, dstRec, () => ({ regionId, index: null }));
                    }}
                    onSplit={(regionId, side) => runNode(regionId, (d, c) => A.splitRegionAction(d, c, regionId, side))}
                    onRemoveRegion={(regionId) => runNode(regionId, (d, c) => A.removeRegionAction(d, c, regionId))}
                    onResize={(changes) => {
                      if (changes.length > 0) runNode(changes[0].id, (d, c) => A.resizeNodes(d, c, changes));
                    }}
                    onResizeCmp={(id, size, grow) => runCmp(id, (d, c) => A.setComponentSize(d, c, id, size, grow))}
                    onMoveCmp={(id, pos, grow, stamp) => runCmp(id, (d, c) => A.setComponentPosition(d, c, id, pos.x, pos.y, grow, stamp ?? null))}
                  />
                ) : (
                  <div className="frame-body flat"><div className="empty-hint">Loading page…</div></div>
                )}
              </div>
              </Stage>
            </div>
            <ElementBar
              cmpType={selectedCmpType}
              canWrite={canWrite}
              onAdd={(type) => {
                if (selectedCmpId) addElementTo(selectedCmpId, type);
              }}
              recipeDisabled={() => (busy ? "Busy" : crudDisabledReason(selectedCmp))}
              onRunRecipe={(id) => {
                if (id === "crud" && selectedCmpId) void runCrudRecipe(selectedCmpId);
              }}
            />
          </section>

          {rightCollapsed ? (
            <PanelRail side="right" label="Inspector" shortcut="Ctrl/⌘+I" onExpand={() => setRightCollapsed(false)} />
          ) : (
            <aside className="panel" id="rightPanel">
              {/* Mirrors the Library header: button on the canvas-facing edge, tabs across the rest. */}
              <div className="panel-head panel-head-right">
                <PanelCollapse side="right" label="Inspector" shortcut="Ctrl/⌘+I" onCollapse={() => setRightCollapsed(true)} />
                <div className="panel-tabs" role="tablist" aria-label="Studio panel">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={rightTab === "inspector"}
                    className={`page-subtab${rightTab === "inspector" ? " active" : ""}`}
                    onClick={() => setRightTab("inspector")}
                  >
                    Inspector
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={rightTab === "notes"}
                    className={`page-subtab${rightTab === "notes" ? " active" : ""}`}
                    onClick={() => setRightTab("notes")}
                  >
                    Notes
                    {noteItems.length > 0 && <span className="page-subtab-count">{noteItems.length}</span>}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={rightTab === "tasks"}
                    className={`page-subtab${rightTab === "tasks" ? " active" : ""}`}
                    onClick={() => setRightTab("tasks")}
                  >
                    Tasks
                    {openTaskCount > 0 && <span className="page-subtab-count">{openTaskCount}</span>}
                  </button>
                </div>
              </div>
              {rightTab !== "inspector" ? (
                <AnnotationsPanel
                  key={rightTab}
                  kind={rightTab === "tasks" ? "task" : "note"}
                  items={rightTab === "tasks" ? taskItems : noteItems}
                  loading={annotationsLoad.loading}
                  error={annotationsLoad.error}
                  pages={pages}
                  activePageId={activePageId}
                  composerTarget={composerTarget}
                  // A member may add tasks and nothing else, so the Notes tab
                  // stays composer-less for them and no row offers Edit or
                  // Delete on either tab.
                  canCreate={canWrite || (rightTab === "tasks" && canAddTasks)}
                  canWrite={canWrite}
                  describeTarget={describeTarget}
                  hotTarget={hotMark}
                  onHoverTarget={setHotMark}
                  onCreate={(text) => createAnnotation(rightTab === "tasks" ? "task" : "note", text)}
                  onEdit={(a, text) => patchAnnotation(a, { text })}
                  onDelete={removeAnnotation}
                  onResolve={(a, resolved) => patchAnnotation(a, { resolved })}
                  onJump={jumpToAnnotation}
                />
              ) : page ? (
            <Inspector
              page={page}
              documents={[page.document, ...host.map((h) => h.doc)]}
              pages={pages}
              datasets={datasets}
              selection={selection}
              selectedCmp={selectedCmp}
              canWrite={canWrite}
              onPageField={(field, value) => run((d) => { d[field] = value; d.route = slugOf(value); }, `page.${field}`)}
              onCmpType={(id, type) => runCmp(id, (d, c) => A.setComponentType(d, c, id, type))}
              onCmpShape={(id, shapeId) => runCmp(id, (d, c) => A.setComponentShape(d, c, id, shapeId))}
              onCmpLayout={(id, layoutId) => runCmp(id, (d, c) => A.setComponentLayout(d, c, id, layoutId))}
              onCmpLabel={(id, label) => runCmp(id, (d, c) => A.setComponentLabel(d, c, id, label), `label.${id}`)}
              onCmpProp={(id, key, value) => runCmp(id, (d, c) => A.setPropValue(d, c, id, key, value), `prop.${id}.${key}`)}
              onCmpHeight={(id, mode) => runCmp(id, (d, c) => A.setComponentHeight(d, c, id, mode))}
              onCmpWidth={(id, w) => runCmp(id, (d, c) => A.setComponentWidth(d, c, id, w))}
              onCmpFloat={(id, floating) => {
                // Floating freezes the rendered box; measure before the
                // commit re-renders it.
                const stamp = floating ? measureCmpStamp(id) : null;
                runCmp(id, (d, c) => A.setComponentFloat(d, c, id, floating, stamp));
              }}
              onRegionLabel={(id, label) => runNode(id, (d, c) => A.setRegionLabelAction(d, c, id, label), `region.${id}`)}
              onRegionBg={(id, bg) => runNode(id, (d, c) => A.setRegionBgAction(d, c, id, bg), `region-bg.${id}`)}
              onRegionSize={(id, size) => runNode(id, (d, c) => A.resizeNodes(d, c, [{ id, size }]))}
              onRegionDir={(id, dir) => {
                // Free layout freezes the rendered boxes; measure before the
                // commit re-renders them.
                const stamps = dir === "free" ? measureFreeStamps(id) : undefined;
                runNode(id, (d, c) => A.setRegionDirAction(d, c, id, dir, stamps));
              }}
              onSplit={(id, side) => runNode(id, (d, c) => A.splitRegionAction(d, c, id, side))}
              onRemoveRegion={(id) => runNode(id, (d, c) => A.removeRegionAction(d, c, id))}
              onElementText={commitElementText}
              onElementData={(sel, key, value) => {
                if (isElKey(sel.key)) runCmp(sel.cmpId, (d, c) => A.setElementData(d, c, sel.cmpId, sel.key.slice(EL_PREFIX.length), key, value), `eldata.${sel.cmpId}.${sel.key}.${key}`);
              }}
              onMoveElement={(sel, delta) => {
                if (isElKey(sel.key)) runCmp(sel.cmpId, (d, c) => A.moveElement(d, c, sel.cmpId, sel.key.slice(EL_PREFIX.length), delta));
              }}
              onRemoveElement={(sel) => {
                if (isElKey(sel.key)) runCmp(sel.cmpId, (d, c) => A.removeElement(d, c, sel.cmpId, sel.key.slice(EL_PREFIX.length)));
              }}
              onSetLink={(sel, target) => {
                runCmp(sel.cmpId, (d, c) => A.setElementLink(d, c, sel.cmpId, sel.key, sel.index, target));
                // Clearing a link has no destination, and Back resolves only
                // at follow time; every real page target opens.
                if (!target || target.pageId === BACK_PAGE_ID) return;
                if (pages.some((p) => p.id === target.pageId)) openLinkedPage(target.pageId);
                else toast("The linked page no longer exists");
              }}
              onCreateLinkedPage={(sel, regionId, presentation) => void createLinkedPage(sel, regionId, undefined, presentation)}
              onHoverLinkRegion={setLinkHotRegion}
              linkRegions={linkRegions}
              onPagePresentation={(value) => {
                run((d) => {
                  d.presentation = value;
                });
                void wireframe.reload();
              }}
              onCreateDataset={openCreateDataset}
              onUpdateDatasetValues={updateDatasetValues}
              onDeleteDataset={removeDataset}
            />
              ) : (
                <div className="panel-body" />
              )}
            </aside>
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

      <Drawer
        open={!!datasetDraft}
        title="New dataset"
        description="A reusable list of values; every wireframe in this project can bind columns and dropdowns to it."
        onClose={() => setDatasetDraft(null)}
        onSubmit={submitDataset}
        footer={
          <>
            <button type="button" className="btn ghost" onClick={() => setDatasetDraft(null)}>Cancel</button>
            <button className="btn primary" disabled={busy || !datasetDraft?.name.trim()}>
              {busy ? "Creating…" : "Create dataset"}
            </button>
          </>
        }
      >
        <Field label="Name">
          <input
            className="input"
            required
            value={datasetDraft?.name ?? ""}
            onChange={(e) => setDatasetDraft((d) => d && { ...d, name: e.target.value })}
          />
        </Field>
        <Field label="Data kind">
          <select
            className="select"
            value={datasetDraft?.kind ?? "text"}
            onChange={(e) => setDatasetDraft((d) => d && { ...d, kind: e.target.value as DataKind })}
          >
            {DATA_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </Field>
        <Field label="Values">
          <textarea
            className="input"
            rows={8}
            placeholder={"One value per line"}
            value={datasetDraft?.values ?? ""}
            onChange={(e) => setDatasetDraft((d) => d && { ...d, values: e.target.value })}
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
