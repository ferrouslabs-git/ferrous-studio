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
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
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
  getWireframeExport,
  getWireframePage,
} from "../project/wireframes/wireframesApi";
import { replaceCustomComponents } from "../projects/projectsApi";
import { Builder } from "./builder/Builder";
import { Canvas, HostLevel } from "./components/Canvas";
import { Inspector } from "./components/Inspector";
import { Library, LibTab } from "./components/Library";
import { PanelRail } from "./components/PanelRail";
import { SchematicEdit } from "./components/Schematic";
import { ElementSel, Selection } from "./components/selection";
import { PageTabs } from "./components/Tabs";
import * as A from "./model/actions";
import { ActionContext, ActionResult, CustomDef, elementValue, elKey, EL_PREFIX, isElKey, locateCmp } from "./model/actions";
import { PageLike } from "./model/applyOps";
import { diffPage } from "./model/diff";
import { usePageHistory } from "./model/history";
import { byPos, isLegacyDocument, normalizePage, posAfterLast } from "./model/positions";
import { regionDisplayName, regionIds } from "./model/tree";
import { LayoutNode, LinkTarget, PageRecord } from "./model/types";
import { SyncStatus } from "./sync/SyncStatus";
import { useWireframeSync } from "./sync/useWireframeSync";

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
  // Drawers: new page, save version, and the delete confirmation.
  const [pageDraft, setPageDraft] = useState<{ name: string; route: string; routeTouched: boolean } | null>(null);
  const [versionDraft, setVersionDraft] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: string } | null>(null);
  const [busy, setBusy] = useState(false);
  /** A pre-tree document was reset on load; persist the reset once the state settles. */
  const [pendingReset, setPendingReset] = useState<{ pageId: string; root: LayoutNode } | null>(null);
  /** Load-time normalisation (legacy component migration, pos repair) to
   *  persist as one batch, so the stored document catches up with what the
   *  editor shows and later per-key edits land on the converted form. */
  const [pendingMigrate, setPendingMigrate] = useState<{ pageId: string; ops: ReturnType<typeof diffPage> } | null>(null);

  const pages = useMemo(() => byPos(wireframe.data?.pages ?? []), [wireframe.data]);

  useEffect(() => {
    setCustomComponents(project.custom_components as CustomDef[]);
  }, [project.custom_components]);

  useEffect(() => {
    if (!activePageId && pages.length) setActivePageId(pages[0].id);
    if (activePageId && pages.length && !pages.some((p) => p.id === activePageId)) setActivePageId(pages[0].id);
  }, [pages, activePageId]);

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
  const history = usePageHistory(page, sync, sync.resetToken);

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
          levels.unshift({ pageId: parent.id, pageName: parent.name, doc: parent.document, regionId: placement.region_id });
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

  /** Run an action through history and apply its UI hints. */
  const run = useCallback(
    (fn: (draft: PageLike, ctx: ActionContext) => ActionResult | void, coalesceKey?: string) => {
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

  // Keyboard: undo/redo, panel toggles, element editing.
  const dialogOpen = builder.open || !!pageDraft || versionDraft !== null || !!pendingDelete;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (dialogOpen) return;
      if (["INPUT", "TEXTAREA", "SELECT"].includes((e.target as HTMLElement).tagName)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z" && e.shiftKey) { history.redo(); e.preventDefault(); }
      else if (mod && e.key.toLowerCase() === "y") { history.redo(); e.preventDefault(); }
      else if (mod && e.key.toLowerCase() === "z") { history.undo(); e.preventDefault(); }
      else if (mod && e.key.toLowerCase() === "b") { setLeftCollapsed((v) => !v); e.preventDefault(); }
      else if (mod && e.key.toLowerCase() === "i") { setRightCollapsed((v) => !v); e.preventDefault(); }
      else if ((e.key === "Enter" || e.key === "F2") && selection?.kind === "element" && canWrite) {
        setEditingElement(selection);
        e.preventDefault();
      } else if ((e.key === "Delete" || e.key === "Backspace") && selection?.kind === "element" && isElKey(selection.key) && canWrite) {
        run((d, c) => A.removeElement(d, c, selection.cmpId, selection.key.slice(EL_PREFIX.length)));
        e.preventDefault();
      } else if (e.key === "Escape") {
        setSelection(null);
        setEditingElement(null);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [history, dialogOpen, selection, canWrite, run]);

  // ── Pages (wireframe-level REST) ─────────────────────────────────────────

  const slugOf = (name: string) => "/" + name.trim().toLowerCase().replace(/\s+/g, "-");

  const openAddPage = () => setPageDraft({ name: "New page", route: slugOf("New page"), routeTouched: false });

  const submitPage = async (e: FormEvent) => {
    e.preventDefault();
    if (!pageDraft || !pageDraft.name.trim()) return;
    setBusy(true);
    try {
      const created = await createWireframePage(projectId, wireframeId, {
        name: pageDraft.name.trim(),
        route: pageDraft.route.trim(),
        pos: posAfterLast(pages),
      });
      await wireframe.reload();
      setActivePageId(created.id);
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

  const submitVersion = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const v = await createWireframeVersion(projectId, wireframeId, versionDraft?.trim() || undefined);
      toast(`Saved version ${v.label ?? v.id.slice(0, 8)}`);
      setVersionDraft(null);
    } catch (err) {
      setNotice(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  // ── Links ─────────────────────────────────────────────────────────────────

  const followLink = useCallback(
    (target: LinkTarget) => {
      if (pages.some((p) => p.id === target.pageId)) {
        setActivePageId(target.pageId);
      } else {
        toast("The linked page no longer exists");
      }
    },
    [pages, toast],
  );

  const createLinkedPage = async (sel: ElementSel, regionId: string | null) => {
    if (!page || busy) return;
    const seed = selectedCmp ? elementValue(selectedCmp, sel.key, sel.index) : "";
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

  const editFor = useCallback(
    (id: string): SchematicEdit => ({
      setPropValue: (key, text) => run((d, c) => A.setPropValue(d, c, id, key, text)),
      setElementLabel: (elId, text) => run((d, c) => A.setElementText(d, c, id, elKey(elId), null, text)),
      setElementData: (elId, key, value) => run((d, c) => A.setElementData(d, c, id, elId, key, value)),
      addElement: (type) => run((d, c) => A.addElement(d, c, id, type)),
      removeElement: (elId) => run((d, c) => A.removeElement(d, c, id, elId)),
      addRow: () => run((d, c) => A.addListRow(d, c, id)),
      setListCell: (row, columnId, text) => run((d, c) => A.setListCell(d, c, id, row, columnId, text)),
      moveElementTo: (elId, x, y) => run((d, c) => A.setElementPosition(d, c, id, elId, x, y)),
    }),
    [run],
  );

  if (wireframe.loading) return <div className="page muted">Loading…</div>;
  if (wireframe.error || !wireframe.data) return <div className="page error">{wireframe.error ?? "Not found"}</div>;

  const builderInitial = builder.defId ? customComponents.find((d) => d.id === builder.defId) ?? null : null;

  return (
    <div className="studio">
      <div className="topbar">
        <div className="brand">{wireframe.data.name}{!canWrite && <span className="v"> · read only</span>}</div>
        <div className="crumbs">{project.name} · {wireframe.data.interface_type} · Schema <b>v{project.schema_version}</b></div>
        <div className="spacer" />
        <SyncStatus snapshot={sync.snapshot} onRetry={sync.retryNow} />
        {canWrite && (
          <>
            <button className="btn ghost" disabled={!history.canUndo} title="Undo (Ctrl/⌘+Z)" onClick={history.undo}>↶ Undo</button>
            <button className="btn ghost" disabled={!history.canRedo} title="Redo (Ctrl/⌘+Shift+Z)" onClick={history.redo}>↷ Redo</button>
            <button className="btn ghost" onClick={openAddPage}>Add page</button>
            <button className="btn ghost" onClick={() => setVersionDraft("")}>Save version</button>
          </>
        )}
        <button
          className="btn primary"
          onClick={() =>
            void getWireframeExport(projectId, wireframeId)
              .then((doc) => navigator.clipboard.writeText(JSON.stringify(doc, null, 2)))
              .then(() => toast("Copied wireframe JSON to clipboard"))
              .catch((err) => setNotice(errorMessage(err)))
          }
        >
          Copy JSON
        </button>
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
              if (selectedCmpId) run((d, c) => A.addElement(d, c, selectedCmpId, type));
            }}
            onNewCustom={() => setBuilder({ open: true, defId: null })}
            onEditCustom={(id) => setBuilder({ open: true, defId: id })}
          />
          )}

          <section className="panel center">
            <PageTabs pages={pages} activeId={activePageId} canWrite={canWrite} onSelect={setActivePageId} onAdd={openAddPage} onDelete={removePage} />
            <div className="canvas-wrap">
              <div className="device">
                {page ? (
                  <Canvas
                    doc={page.document}
                    host={host}
                    selection={selection}
                    editingElement={editingElement}
                    defs={customComponents}
                    canWrite={canWrite}
                    onSelect={setSelection}
                    editFor={editFor}
                    onEditEnd={() => setEditingElement(null)}
                    onFollow={followLink}
                    onOpenPage={setActivePageId}
                    onMove={(id, delta) => run((d, c) => A.moveComponent(d, c, id, delta))}
                    onRemove={(id) => run((d, c) => A.removeComponent(d, c, id))}
                    onEditStructure={openBuilderFor}
                    onDropPattern={(id, regionId) => run((d, c) => A.applyPattern(d, c, id, regionId))}
                    onDropComponent={(type, customId, regionId, index, shapeId) =>
                      run((d, c) => A.appendComponent(d, c, { type, shape: shapeId }, regionId, index, customId ?? null))
                    }
                    onDropElement={(type, cmpId) => run((d, c) => A.addElement(d, c, cmpId, type))}
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
              onPageField={(field, value) => run((d) => { d[field] = value; }, `page.${field}`)}
              onCmpType={(id, type) => run((d, c) => A.setComponentType(d, c, id, type))}
              onCmpShape={(id, shapeId) => run((d, c) => A.setComponentShape(d, c, id, shapeId))}
              onCmpLayout={(id, layoutId) => run((d, c) => A.setComponentLayout(d, c, id, layoutId))}
              onCmpLabel={(id, label) => run((d, c) => A.setComponentLabel(d, c, id, label), `label.${id}`)}
              onRegionLabel={(id, label) => run((d, c) => A.setRegionLabelAction(d, c, id, label), `region.${id}`)}
              onRegionSize={(id, size) => run((d, c) => A.resizeNodes(d, c, [{ id, size }]))}
              onSplit={(id, side) => run((d, c) => A.splitRegionAction(d, c, id, side))}
              onRemoveRegion={(id) => run((d, c) => A.removeRegionAction(d, c, id))}
              onElementText={(sel, text) => run((d, c) => A.setElementText(d, c, sel.cmpId, sel.key, sel.index, text))}
              onElementData={(sel, key, value) => {
                if (isElKey(sel.key)) run((d, c) => A.setElementData(d, c, sel.cmpId, sel.key.slice(EL_PREFIX.length), key, value));
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
        description="A page is one screen of this wireframe; its route is the URL it would live at."
        onClose={() => setPageDraft(null)}
        onSubmit={submitPage}
        footer={
          <>
            <button type="button" className="btn ghost" onClick={() => setPageDraft(null)}>Cancel</button>
            <button className="btn primary" disabled={busy || !pageDraft?.name.trim()}>{busy ? "Creating…" : "Create page"}</button>
          </>
        }
      >
        <Field label="Name">
          <input
            className="input"
            required
            value={pageDraft?.name ?? ""}
            onChange={(e) =>
              setPageDraft((d) => d && { ...d, name: e.target.value, route: d.routeTouched ? d.route : slugOf(e.target.value) })
            }
          />
        </Field>
        <Field label="Route" hint="Suggested from the name; edit it if the URL should differ.">
          <input
            className="input"
            value={pageDraft?.route ?? ""}
            onChange={(e) => setPageDraft((d) => d && { ...d, route: e.target.value, routeTouched: true })}
          />
        </Field>
      </Drawer>

      <Drawer
        open={versionDraft !== null}
        title="Save version"
        description="Takes a snapshot of every page in this wireframe as it is now."
        onClose={() => setVersionDraft(null)}
        onSubmit={submitVersion}
        footer={
          <>
            <button type="button" className="btn ghost" onClick={() => setVersionDraft(null)}>Cancel</button>
            <button className="btn primary" disabled={busy}>{busy ? "Saving…" : "Save version"}</button>
          </>
        }
      >
        <Field label="Label" hint="Optional.">
          <input className="input" placeholder="e.g. Before client review" value={versionDraft ?? ""} onChange={(e) => setVersionDraft(e.target.value)} />
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
