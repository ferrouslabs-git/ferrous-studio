// The studio: three-pane editor (library · canvas · inspector) over one page
// of a project, with pages/frames tabs, undo/redo, the component builder,
// and immediate persistence through the outbox.
//
// Every edit is `history.commit(draft => action(draft, ctx, ...))`: the
// action mutates the draft (legacy code, nearly verbatim), the history hook
// diffs it into id-addressed ops and hands them to the outbox, and the UI
// re-renders from the new state. Undo restores a snapshot the same way.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useSession } from "../../app/session";
import { errorMessage } from "../../core/api";
import { useLoad } from "../../core/useLoad";
import {
  createPage,
  createVersion,
  deletePage,
  getPage,
  getProject,
  getProjectExport,
  replaceCustomComponents,
} from "../projects/projectsApi";
import { Builder } from "./builder/Builder";
import { Canvas } from "./components/Canvas";
import { Inspector } from "./components/Inspector";
import { Library, LibTab } from "./components/Library";
import { SchematicEdit } from "./components/Schematic";
import { FrameTabs, PageTabs } from "./components/Tabs";
import * as A from "./model/actions";
import { ActionContext, ActionResult, CustomDef, frameOf, locateCmp } from "./model/actions";
import { PageLike } from "./model/applyOps";
import { usePageHistory } from "./model/history";
import { byPos, normalizePage, posAfterLast } from "./model/positions";
import { PageRecord, RegionName } from "./model/types";
import { SyncStatus } from "./sync/SyncStatus";
import { useProjectSync } from "./sync/useProjectSync";

export function StudioPage() {
  const { projectId = "" } = useParams();
  const { canWrite, activeOrg } = useSession();
  const project = useLoad(() => getProject(projectId), [projectId]);
  const [customComponents, setCustomComponents] = useState<CustomDef[]>([]);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [page, setPage] = useState<PageRecord | null>(null);
  const [activeFrameId, setActiveFrameId] = useState<string | null>(null);
  const [selectedCmpId, setSelectedCmpId] = useState<string | null>(null);
  const [libTab, setLibTab] = useState<LibTab>("components");
  const [builder, setBuilder] = useState<{ open: boolean; defId: string | null }>({ open: false, defId: null });
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const pages = useMemo(() => byPos(project.data?.pages ?? []), [project.data]);

  useEffect(() => {
    if (project.data) setCustomComponents(project.data.custom_components as CustomDef[]);
  }, [project.data]);

  useEffect(() => {
    if (!activePageId && pages.length) setActivePageId(pages[0].id);
    if (activePageId && pages.length && !pages.some((p) => p.id === activePageId)) setActivePageId(pages[0].id);
  }, [pages, activePageId]);

  useEffect(() => {
    if (!activePageId) return;
    let cancelled = false;
    setPage(null);
    getPage(projectId, activePageId)
      .then((p) => {
        if (cancelled) return;
        const normalised = normalizePage(p);
        setPage(normalised);
        setActiveFrameId(normalised.document.frames[0]?.id ?? null);
        setSelectedCmpId(null);
      })
      .catch((err) => setNotice(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [projectId, activePageId]);

  const sync = useProjectSync(projectId, page, setPage);
  const history = usePageHistory(page, sync, sync.resetToken);

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

  const ctx: ActionContext = useMemo(
    () => ({ frameId: activeFrameId ?? "", customComponents }),
    [activeFrameId, customComponents],
  );

  /** Run an action through history and apply its UI hints. */
  const run = useCallback(
    (fn: (draft: PageLike, ctx: ActionContext) => ActionResult | void, coalesceKey?: string) => {
      if (!canWrite) return;
      const result = history.commit((draft) => fn(draft, ctx), { coalesceKey });
      if (!result) return;
      if (result.selectCmpId !== undefined) setSelectedCmpId(result.selectCmpId);
      if (result.selectFrameId) setActiveFrameId(result.selectFrameId);
      if (result.toast) toast(result.toast);
      if (result.newDef) persistDefs([...customComponents, result.newDef]);
    },
    [canWrite, history, ctx, toast, persistDefs, customComponents],
  );

  const frame = page ? (frameOf(page, activeFrameId) ?? page.document.frames[0] ?? null) : null;
  const selected = frame && selectedCmpId ? (locateCmp(frame, selectedCmpId)?.list[locateCmp(frame, selectedCmpId)!.index] ?? null) : null;

  // Keyboard: undo/redo and panel toggles when the builder is closed.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (builder.open) return;
      if (["INPUT", "TEXTAREA", "SELECT"].includes((e.target as HTMLElement).tagName)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z" && e.shiftKey) { history.redo(); e.preventDefault(); }
      else if (mod && e.key.toLowerCase() === "y") { history.redo(); e.preventDefault(); }
      else if (mod && e.key.toLowerCase() === "z") { history.undo(); e.preventDefault(); }
      else if (mod && e.key.toLowerCase() === "b") { setLeftCollapsed((v) => !v); e.preventDefault(); }
      else if (mod && e.key.toLowerCase() === "i") { setRightCollapsed((v) => !v); e.preventDefault(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [history, builder.open]);

  // ── Pages (project-level REST) ────────────────────────────────────────────

  const addPage = async () => {
    const name = prompt("Page name?", "New page");
    if (!name) return;
    const route = prompt("Route?", "/" + name.toLowerCase().replace(/\s+/g, "-"));
    if (route == null) return;
    try {
      const created = await createPage(projectId, { name, route, pos: posAfterLast(pages) });
      await project.reload();
      setActivePageId(created.id);
    } catch (err) {
      setNotice(errorMessage(err));
    }
  };

  const removePage = async (id: string) => {
    if (pages.length <= 1 || !confirm("Delete this page?")) return;
    try {
      await deletePage(projectId, id);
      await project.reload();
      if (activePageId === id) setActivePageId(null);
    } catch (err) {
      setNotice(errorMessage(err));
    }
  };

  // ── Frames ────────────────────────────────────────────────────────────────

  const addFrame = () => {
    if (!page) return;
    const label = prompt("Frame label?", `Variant ${page.document.frames.length + 1}`);
    if (!label) return;
    const clone = confirm("Clone the current frame? Cancel for an empty frame.");
    run((d, c) => A.addFrame(d, c, label, clone));
  };

  const removeFrame = (id: string) => {
    if (!page || page.document.frames.length <= 1 || !confirm("Delete this frame?")) return;
    run((d, c) => A.deleteFrame(d, c, id));
  };

  // ── Builder ───────────────────────────────────────────────────────────────

  const openBuilderFor = (cmpId: string) => {
    const cmp = frame && locateCmp(frame, cmpId);
    const node = cmp ? cmp.list[cmp.index] : null;
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
    run((d, c) => {
      const loc = frameOf(d, c.frameId) && locateCmp(frameOf(d, c.frameId)!, cmpId);
      if (loc) loc.list[loc.index].customId = created.id;
      return { newDef: created };
    });
    setBuilder({ open: true, defId: created.id });
  };

  const editFor = useCallback(
    (id: string): SchematicEdit => ({
      setPropValue: (key, text) => run((d, c) => A.setPropValue(d, c, id, key, text)),
      renamePropItem: (key, index, text) => run((d, c) => A.renamePropItem(d, c, id, key, index, text)),
      setPropPath: (path, text) => run((d, c) => A.setPropPath(d, c, id, path, text)),
      addPropItem: (key) => run((d, c) => A.addPropItem(d, c, id, key)),
      addRow: () => run((d, c) => A.addPropRow(d, c, id)),
      addColumn: () => run((d, c) => A.addPropColumn(d, c, id)),
      renameShellGroupTitle: (g, text) => run((d, c) => A.renameShellGroupTitle(d, c, id, g, text)),
      addShellItem: (g) => run((d, c) => A.addShellItem(d, c, id, g)),
      renameShellItem: (index, text, g) => run((d, c) => A.renameShellItem(d, c, id, index, text, g)),
    }),
    [run],
  );

  if (project.loading) return <div className="page muted">Loading…</div>;
  if (project.error || !project.data) return <div className="page error">{project.error ?? "Not found"}</div>;

  const builderInitial = builder.defId ? customComponents.find((d) => d.id === builder.defId) ?? null : null;

  return (
    <div className="studio">
      <div className="topbar">
        <Link to={`/orgs/${activeOrg?.id}/projects`} className="btn ghost small">← Projects</Link>
        <div className="brand">{project.data.name}{!canWrite && <span className="v"> · read only</span>}</div>
        <div className="crumbs">Schema <b>v{project.data.schema_version}</b></div>
        <div className="spacer" />
        <SyncStatus snapshot={sync.snapshot} onRetry={sync.retryNow} />
        {canWrite && (
          <>
            <button className="btn ghost" disabled={!history.canUndo} title="Undo (Ctrl/⌘+Z)" onClick={history.undo}>↶ Undo</button>
            <button className="btn ghost" disabled={!history.canRedo} title="Redo (Ctrl/⌘+Shift+Z)" onClick={history.redo}>↷ Redo</button>
            <button className="btn ghost" onClick={() => void addPage()}>Add page</button>
            <button className="btn ghost" onClick={addFrame}>Add frame</button>
            <button
              className="btn ghost"
              onClick={() =>
                void createVersion(projectId, prompt("Version label (optional)") ?? undefined)
                  .then((v) => toast(`Saved version ${v.label ?? v.id.slice(0, 8)}`))
                  .catch((err) => setNotice(errorMessage(err)))
              }
            >
              Save version
            </button>
          </>
        )}
        <button
          className="btn primary"
          onClick={() =>
            void getProjectExport(projectId)
              .then((doc) => navigator.clipboard.writeText(JSON.stringify(doc, null, 2)))
              .then(() => toast("Copied project JSON to clipboard"))
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
          <Library
            tab={libTab}
            onTab={setLibTab}
            customComponents={customComponents}
            canWrite={canWrite}
            onApplyPattern={(id) => run((d, c) => A.applyPattern(d, c, id))}
            onAddComponent={(type, customId) => run((d, c) => A.appendComponent(d, c, type, null, null, customId ?? null))}
            onNewCustom={() => setBuilder({ open: true, defId: null })}
            onEditCustom={(id) => setBuilder({ open: true, defId: id })}
          />

          <section className="panel center">
            <PageTabs pages={pages} activeId={activePageId} canWrite={canWrite} onSelect={setActivePageId} onAdd={() => void addPage()} onDelete={(id) => void removePage(id)} />
            <FrameTabs
              frames={page?.document.frames ?? []}
              activeId={frame?.id ?? null}
              canWrite={canWrite}
              onSelect={(id) => { setActiveFrameId(id); setSelectedCmpId(null); }}
              onAdd={addFrame}
              onDelete={removeFrame}
            />
            <div className="canvas-wrap">
              <div className="device">
                <div className="device-bar">
                  <span className="dot" /><span className="dot" /><span className="dot" />
                  <span className="url">{(project.data.name || "app").toLowerCase().replace(/\s+/g, "-")}.app{page?.route ?? "/"}</span>
                </div>
                {page ? (
                  <Canvas
                    frame={frame}
                    selectedId={selectedCmpId}
                    defs={customComponents}
                    canWrite={canWrite}
                    onSelect={setSelectedCmpId}
                    editFor={editFor}
                    onMove={(id, delta) => run((d, c) => A.moveComponent(d, c, id, delta))}
                    onRemove={(id) => run((d, c) => A.removeComponent(d, c, id))}
                    onEditStructure={openBuilderFor}
                    onDropPattern={(id, region, index) => run((d, c) => A.applyPattern(d, c, id, region, index))}
                    onDropComponent={(type, customId, region, index) => run((d, c) => A.appendComponent(d, c, type, region, index, customId ?? null))}
                    onReorder={(src, target, before) => run((d, c) => A.reorderById(d, c, src, target, before))}
                    onMoveToRegion={(src, region: RegionName) => run((d, c) => A.moveToRegion(d, c, src, region))}
                  />
                ) : (
                  <div className="frame-body"><div className="empty-hint">Loading page…</div></div>
                )}
              </div>
            </div>
          </section>

          {page ? (
            <Inspector
              page={page}
              frame={frame}
              selected={selected}
              canWrite={canWrite}
              onPageField={(field, value) => run((d) => { d[field] = value; }, `page.${field}`)}
              onSelectFrame={(id) => { setActiveFrameId(id); setSelectedCmpId(null); }}
              onLayoutMode={(mode) => run((d, c) => A.setLayoutMode(d, c, mode))}
              onSmartDock={(on) => run((d, c) => A.setFrameOptions(d, c, { smartDock: on }))}
              onMainFlow={(flow) => run((d, c) => A.setFrameOptions(d, c, { mainFlow: flow }))}
              onCmpType={(id, type) => run((d, c) => A.setComponentType(d, c, id, type))}
              onCmpLabel={(id, label) => run((d, c) => A.setComponentLabel(d, c, id, label), `label.${id}`)}
            />
          ) : (
            <aside className="panel" id="rightPanel"><div className="panel-head">Inspector</div></aside>
          )}
        </div>
        <button className="toggle left" title="Collapse library (Ctrl/⌘+B)" aria-label="Toggle library panel" onClick={() => setLeftCollapsed((v) => !v)}>‹</button>
        <button className="toggle right" title="Collapse inspector (Ctrl/⌘+I)" aria-label="Toggle inspector panel" onClick={() => setRightCollapsed((v) => !v)}>›</button>
      </div>

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
