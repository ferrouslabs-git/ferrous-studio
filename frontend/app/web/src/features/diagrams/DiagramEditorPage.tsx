// The diagram editor: palette · canvas · inspector over one diagram, saved
// whole (maxGraph XML + derived model) with a debounced autosave and a
// version check. A 409 means the diagram changed elsewhere; autosave stops
// until the reviewer reloads.
//
// There is no Save button: every change autosaves, the indicator in the topbar
// says where that has got to, and Ctrl+S flushes the debounce for anyone who
// reaches for it out of habit.
import type { FitPlugin } from "@maxgraph/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { ApiError, errorMessage } from "../../core/api";
import { useLoad } from "../../core/useLoad";
import { useProject } from "../project/ProjectLayout";
import { diagramKindLabel, DiagramRecord, getDiagram, saveDiagram } from "../project/diagrams/diagramsApi";
import { Inspector } from "./components/Inspector";
import { Palette } from "./components/Palette";
import { CLIPBOARD_KEY, hasClipboard } from "./graph/clipboard";
import type { GraphHandle } from "./graph/createGraph";
import { deriveModel, exportXml, importXml, plainCellsOf } from "./graph/serialize";
import { useGraph } from "./graph/useGraph";
import "./diagram.css";

const AUTOSAVE_MS = 1500;

type SaveState = { kind: "clean" } | { kind: "dirty" } | { kind: "saving" } | { kind: "saved"; at: number } | { kind: "error"; message: string } | { kind: "conflict"; version: number };

export function DiagramEditorPage() {
  const { diagramId = "" } = useParams();
  const { project, orgId, canWrite } = useProject();
  const record = useLoad(() => getDiagram(project.id, diagramId), [project.id, diagramId]);
  const { containerRef, handleRef, state, whileImporting } = useGraph();
  const [save, setSave] = useState<SaveState>({ kind: "clean" });
  const [gridOn, setGridOn] = useState(true);
  const [canPaste, setCanPaste] = useState(hasClipboard);
  const versionRef = useRef(0);
  const loadedRef = useRef<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);
  const againRef = useRef(false);
  const saveRef = useRef<SaveState>(save);
  saveRef.current = save;

  // Load the document into the graph once both are ready.
  useEffect(() => {
    const handle = handleRef.current;
    const data = record.data;
    if (!state.ready || !handle || !data || loadedRef.current === data.id) return;
    loadedRef.current = data.id;
    versionRef.current = data.version;
    whileImporting(() => {
      if (data.xml) {
        try {
          importXml(handle.graph, data.xml);
        } catch (err) {
          setSave({ kind: "error", message: `Could not read the saved diagram: ${errorMessage(err)}` });
        }
      }
      handle.undoManager.clear();
      fitView(handle);
    });
  }, [state.ready, record.data, handleRef, whileImporting]);

  const doSave = useCallback(async () => {
    const handle = handleRef.current;
    if (!handle || !canWrite || saveRef.current.kind === "conflict") return;
    if (inFlightRef.current) {
      againRef.current = true;
      return;
    }
    inFlightRef.current = true;
    setSave({ kind: "saving" });
    try {
      const xml = exportXml(handle.graph);
      const model = deriveModel(plainCellsOf(handle.graph));
      const saved: DiagramRecord = await saveDiagram(project.id, diagramId, { version: versionRef.current, xml, model });
      versionRef.current = saved.version;
      setSave({ kind: "saved", at: Date.now() });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const body = err.body as { version?: number } | null;
        setSave({ kind: "conflict", version: body?.version ?? -1 });
      } else {
        setSave({ kind: "error", message: errorMessage(err) });
      }
    } finally {
      inFlightRef.current = false;
      if (againRef.current) {
        againRef.current = false;
        void doSave();
      }
    }
  }, [handleRef, canWrite, project.id, diagramId]);

  // Debounced autosave on every model change.
  useEffect(() => {
    if (state.changeTick === 0 || !canWrite) return;
    if (saveRef.current.kind === "conflict") return;
    setSave({ kind: "dirty" });
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => void doSave(), AUTOSAVE_MS);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [state.changeTick, canWrite, doSave]);

  // Ctrl+S from the canvas, and from anywhere on the page.
  useEffect(() => {
    if (handleRef.current) handleRef.current.onSave.current = () => void doSave();
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (timerRef.current) window.clearTimeout(timerRef.current);
        void doSave();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [doSave, handleRef, state.ready]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (save.kind === "dirty" || save.kind === "saving") e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [save.kind]);

  // The clipboard lives in localStorage, so a copy in another tab -- or in
  // another diagram open beside this one -- arms Paste here too.
  useEffect(() => {
    if (handleRef.current) handleRef.current.onClipboardChange.current = () => setCanPaste(hasClipboard());
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === CLIPBOARD_KEY) setCanPaste(hasClipboard());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [handleRef, state.ready]);

  useEffect(() => {
    handleRef.current?.graph.setGridEnabled(gridOn);
  }, [gridOn, handleRef, state.ready]);

  // The canvas keyboard bindings check this before changing anything.
  useEffect(() => {
    if (handleRef.current) handleRef.current.editable.current = canWrite;
  }, [canWrite, handleRef, state.ready]);

  const reload = async () => {
    loadedRef.current = null;
    setSave({ kind: "clean" });
    await record.reload();
  };

  const handle = handleRef.current;
  const readOnly = !canWrite;

  return (
    <div className={`diagram-editor${gridOn ? " grid-on" : ""}`}>
      <div className="topbar">
        <div className="brand">
          {record.data?.name ?? "Diagram"}
          {readOnly && <span className="v"> · read only</span>}
        </div>
        {record.data && <div className="crumbs">{diagramKindLabel(record.data.kind)}</div>}
        <div className="spacer" />
        <SaveIndicator state={save} />
        {!readOnly && (
          <>
            <button className="btn ghost" disabled={!state.canUndo} title="Undo (Ctrl+Z)" onClick={() => handle?.undoManager.undo()}>
              ↶ Undo
            </button>
            <button className="btn ghost" disabled={!state.canRedo} title="Redo (Ctrl+Y)" onClick={() => handle?.undoManager.redo()}>
              ↷ Redo
            </button>
          </>
        )}
        <span className="zoom-group">
          <button className="btn ghost small" title="Zoom out" onClick={() => handle?.graph.zoomOut()}>
            −
          </button>
          <button className="btn ghost small zoom-value" title="Reset zoom" onClick={() => handle?.graph.zoomActual()}>
            {Math.round(state.scale * 100)}%
          </button>
          <button className="btn ghost small" title="Zoom in" onClick={() => handle?.graph.zoomIn()}>
            +
          </button>
          <button className="btn ghost small" title="Fit" onClick={() => handle && fitView(handle)}>
            Fit
          </button>
          <button className={`btn ghost small${gridOn ? " is-on" : ""}`} title="Toggle grid" onClick={() => setGridOn((g) => !g)}>
            Grid
          </button>
        </span>
      </div>

      {record.error && <div className="status-banner warn">{record.error}</div>}
      {save.kind === "error" && (
        <div className="status-banner warn">
          {save.message}
          <span className="shell-spacer" />
          <button className="btn small" onClick={() => void doSave()}>
            Retry
          </button>
        </div>
      )}
      {save.kind === "conflict" && (
        <div className="status-banner warn">
          This diagram was changed elsewhere (now at version {save.version}). Reload to see the latest — your unsaved changes here will be lost.
          <span className="shell-spacer" />
          <button className="btn small primary" onClick={() => void reload()}>
            Reload
          </button>
        </div>
      )}

      <div className="diagram-main">
        <Palette handleRef={handleRef} disabled={readOnly || !state.ready} />
        <div className="diagram-canvas-wrap">
          <div ref={containerRef} className="diagram-canvas" style={gridStyle(state.scale, handle)} />
          {record.loading && <div className="diagram-overlay muted">Loading…</div>}
        </div>
        <Inspector selection={state.selection} handleRef={handleRef} disabled={readOnly} canPaste={canPaste} />
      </div>
    </div>
  );
}

/** Fit the drawing in view, but never zoom *in* past 100% — a few small
 *  shapes should not fill the screen. An empty canvas stays at 100%. */
function fitView(handle: GraphHandle): void {
  const { graph } = handle;
  if (graph.getDefaultParent().getChildCount() === 0) {
    graph.zoomActual();
    return;
  }
  graph.getPlugin<FitPlugin>("fit")?.fitCenter({ margin: 40 });
  if (graph.getView().scale > 1) graph.zoomTo(1, true);
}

function gridStyle(scale: number, handle: ReturnType<typeof useGraph>["handleRef"]["current"]): React.CSSProperties {
  const size = 10 * scale;
  const t = handle?.graph.getView().translate;
  return {
    backgroundSize: `${size}px ${size}px`,
    backgroundPosition: `${(t?.x ?? 0) * scale}px ${(t?.y ?? 0) * scale}px`,
  };
}

function SaveIndicator({ state }: { state: SaveState }) {
  const text =
    state.kind === "clean"
      ? ""
      : state.kind === "dirty"
        ? "Unsaved changes"
        : state.kind === "saving"
          ? "Saving…"
          : state.kind === "saved"
            ? "Saved"
            : state.kind === "conflict"
              ? "Conflict"
              : "Save failed";
  if (!text) return null;
  return <span className={`save-indicator is-${state.kind}`}>{text}</span>;
}
