// Builds the maxGraph instance for one editor: a BaseGraph with exactly the
// plugins we use, the UML stylesheet, label/editing hooks for the user-object
// values, an UndoManager and a KeyHandler, and a dispose() that tears it all
// down (React StrictMode mounts twice in development).
//
// The graph behaviours (getLabel, isHtmlLabel, ...) are mixin instance
// properties, so they are replaced by assignment rather than subclassing.
import "@maxgraph/core/css/common.css";
import {
  BaseGraph,
  Cell,
  CellEditorHandler,
  ConnectionHandler,
  FitPlugin,
  Geometry,
  ImageBox,
  InternalEvent,
  KeyHandler,
  PanningHandler,
  RubberBandHandler,
  SelectionCellsHandler,
  SelectionHandler,
  TooltipHandler,
  UndoManager,
  type EventObject,
} from "@maxgraph/core";
import { applyGraphChrome, registerStyleElements } from "./registerStyleElements";
import { applyUmlTheme, CANVAS_BG, currentUmlTheme, registerUmlStyles, styleName, UmlTheme } from "./umlStyles";
import { EDGE_BY_TYPE, hasCompartments, isEdgeType, NODE_BY_TYPE, UmlEdgeType, UmlNodeType } from "./umlTypes";
import { createUserObject, isUmlCell, readUml, withAttrs } from "./userObject";

export interface GraphHandle {
  graph: BaseGraph;
  undoManager: UndoManager;
  /** Connector type used for the next drawn edge. */
  edgeType: { current: UmlEdgeType };
  insertNode(type: UmlNodeType, x: number, y: number, target?: Cell | null): Cell;
  insertNodeAtCentre(type: UmlNodeType): Cell;
  setAttrs(cell: Cell, patch: Record<string, string>): void;
  setNodeType(cell: Cell, type: UmlNodeType): void;
  setEdgeType(cell: Cell, type: UmlEdgeType): void;
  /** Whether the diagram may be modified; the keyboard bindings respect it. */
  editable: { current: boolean };
  /** Remove the selected cells and the connectors attached to them. */
  deleteSelection(): void;
  zoomTo(scale: number): void;
  onSave: { current: (() => void) | null };
  /** Repaint every cell in the given theme; cells keep their named styles. */
  restyle(theme: UmlTheme): void;
  dispose(): void;
}

const connectIcon = () =>
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.5" fill="#FF5B1A" stroke="${CANVAS_BG}" stroke-width="1.5"/><path d="M5 8h6M8.5 5.5 11 8l-2.5 2.5" stroke="${CANVAS_BG}" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>`,
  );

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function compartmentHtml(cell: Cell): string {
  const a = readUml(cell);
  const head = `${a.stereotype ? `<div class="uml-class-stereo">«${escapeHtml(a.stereotype)}»</div>` : ""}<div class="uml-class-name">${escapeHtml(a.label)}</div>`;
  const section = (text: string) =>
    `<div class="uml-class-sec">${text
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => `<div>${escapeHtml(l)}</div>`)
      .join("") || "&nbsp;"}</div>`;
  return `<div class="uml-class"><div class="uml-class-head">${head}</div>${section(a.attributes)}${section(a.operations)}</div>`;
}

export function createDiagramGraph(container: HTMLElement): GraphHandle {
  applyUmlTheme(currentUmlTheme());
  registerStyleElements();

  const graph = new BaseGraph({
    container,
    plugins: [
      CellEditorHandler,
      ConnectionHandler,
      FitPlugin,
      PanningHandler,
      RubberBandHandler,
      SelectionCellsHandler,
      SelectionHandler,
      TooltipHandler,
    ],
  });
  registerUmlStyles(graph.getStylesheet());

  // Canvas behaviour.
  graph.setPanning(true);
  graph.setGridEnabled(true);
  graph.setGridSize(10);
  graph.setAllowNegativeCoordinates(true);
  graph.setConnectable(true);
  graph.setAllowDanglingEdges(false);
  graph.setMultigraph(true);
  graph.setDisconnectOnMove(false);
  graph.setCellsDisconnectable(true);
  graph.setEdgeLabelsMovable(true);
  graph.setDropEnabled(true);
  graph.setSplitEnabled(false);
  graph.setSwimlaneNesting(true);
  graph.setEnterStopsCellEditing(true);
  graph.setHtmlLabels(true);
  graph.setEscapeEnabled(true);

  const panning = graph.getPlugin<PanningHandler>(PanningHandler.pluginId);
  if (panning) {
    panning.useLeftButtonForPanning = false;
    panning.ignoreCell = false;
  }

  // Labels come from the user object.
  graph.isHtmlLabel = (cell) => isUmlCell(cell) && hasCompartments(readUml(cell).umlType);
  graph.getLabel = (cell) => {
    if (!cell || !isUmlCell(cell)) return "";
    const a = readUml(cell);
    if (hasCompartments(a.umlType)) return compartmentHtml(cell);
    if (cell.isEdge() && !a.label && isEdgeType(a.umlType) && EDGE_BY_TYPE[a.umlType].stereotype) {
      return `«${EDGE_BY_TYPE[a.umlType].stereotype}»`;
    }
    return a.label;
  };
  graph.convertValueToString = (cell) => (isUmlCell(cell) ? readUml(cell).label : "");
  graph.getEditingValue = (cell) => (isUmlCell(cell) ? readUml(cell).label : "");
  graph.cellLabelChanged = (cell, value) => {
    if (!isUmlCell(cell)) return;
    graph.batchUpdate(() => {
      graph.getDataModel().setValue(cell, withAttrs(cell, { label: String(value ?? "") }));
    });
  };
  graph.isCellEditable = (cell) => {
    if (!isUmlCell(cell)) return false;
    const t = readUml(cell).umlType;
    return !(t in NODE_BY_TYPE && NODE_BY_TYPE[t as UmlNodeType].noLabel);
  };
  // Only containers accept drops (swimlanes, boundaries, lifelines).
  graph.isValidDropTarget = (cell) => {
    if (!isUmlCell(cell)) return false;
    const t = readUml(cell).umlType;
    return t in NODE_BY_TYPE && !!NODE_BY_TYPE[t as UmlNodeType].container;
  };

  // New edges carry the connector type chosen in the toolbar.
  const edgeType = { current: "association" as UmlEdgeType };
  const connection = graph.getPlugin<ConnectionHandler>(ConnectionHandler.pluginId);
  if (connection) {
    connection.connectImage = new ImageBox(connectIcon(), 16, 16);
    connection.select = true;
    connection.factoryMethod = () => makeEdge(edgeType.current);
  }

  // Undo/redo.
  const undoManager = new UndoManager(200);
  const undoListener = (_sender: unknown, evt: EventObject) => undoManager.undoableEditHappened(evt.getProperty("edit"));
  graph.getDataModel().addListener(InternalEvent.UNDO, undoListener);
  graph.getView().addListener(InternalEvent.UNDO, undoListener);

  const onSave = { current: null as (() => void) | null };
  const editable = { current: true };

  // Keyboard, only while the canvas has focus -- so Delete in an inspector
  // field edits text rather than removing the shape it is describing.
  //
  // maxGraph consumes mousedown on a cell (it calls preventDefault to start its
  // own drag), which also cancels the browser's default focus transfer, so
  // clicking a shape would otherwise leave focus on the body and every binding
  // below dead. Claim focus first, in the capture phase. The in-place label
  // editor lives inside this same container, so leave text entry alone.
  container.tabIndex = 0;
  const focusCanvas = (e: Event) => {
    const source = e.target as HTMLElement | null;
    if (source?.closest("input, textarea, select, [contenteditable='true']")) return;
    if (!container.contains(document.activeElement)) container.focus({ preventScroll: true });
  };
  container.addEventListener("pointerdown", focusCanvas, true);

  const keys = new KeyHandler(graph, container);
  // Delete and Backspace both remove the selection; Backspace is what Mac
  // keyboards label "delete", and Cmd/Ctrl+Backspace is the habit that comes
  // with it. KeyHandler ignores all of these while a label is being edited.
  const del = () => handle.deleteSelection();
  keys.bindKey(46, del);
  keys.bindKey(8, del);
  keys.bindControlKey(46, del);
  keys.bindControlKey(8, del);
  keys.bindControlKey(90, () => undoManager.undo());
  keys.bindControlKey(89, () => undoManager.redo());
  keys.bindControlShiftKey(90, () => undoManager.redo());
  keys.bindControlKey(65, () => graph.selectAll());
  keys.bindControlKey(83, () => onSave.current?.());
  keys.bindKey(187, () => graph.zoomIn());
  keys.bindKey(189, () => graph.zoomOut());

  // Ctrl+wheel zooms, plain wheel pans.
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      if (e.deltaY < 0) graph.zoomIn();
      else graph.zoomOut();
      return;
    }
    const view = graph.getView();
    const s = view.scale;
    view.setTranslate(view.translate.x - e.deltaX / s, view.translate.y - e.deltaY / s);
  };
  container.addEventListener("wheel", onWheel, { passive: false });

  const resizeObserver = new ResizeObserver(() => graph.sizeDidChange());
  resizeObserver.observe(container);

  function makeVertex(type: UmlNodeType, x: number, y: number): Cell {
    const entry = NODE_BY_TYPE[type];
    const cell = new Cell(createUserObject(type, { label: entry.defaultLabel }), new Geometry(x, y, entry.w, entry.h), {
      baseStyleNames: [styleName(type)],
    });
    cell.setVertex(true);
    cell.setConnectable(!entry.container || type === "lifeline");
    return cell;
  }

  function makeEdge(type: UmlEdgeType): Cell {
    const geometry = new Geometry();
    geometry.relative = true;
    const cell = new Cell(createUserObject(type), geometry, { baseStyleNames: [styleName(type)] });
    cell.setEdge(true);
    return cell;
  }

  const handle: GraphHandle = {
    graph,
    undoManager,
    edgeType,
    onSave,
    insertNode(type, x, y, target) {
      let inserted: Cell[] = [];
      graph.batchUpdate(() => {
        inserted = graph.importCells([makeVertex(type, 0, 0)], x, y, target ?? graph.getDefaultParent());
      });
      graph.setSelectionCells(inserted);
      return inserted[0];
    },
    insertNodeAtCentre(type) {
      const view = graph.getView();
      const entry = NODE_BY_TYPE[type];
      // Cascade successive inserts so they do not land on top of each other.
      const existing = graph.getDefaultParent().getChildCount();
      const step = (existing % 8) * 24;
      const x = container.clientWidth / 2 / view.scale - view.translate.x - entry.w / 2 + step;
      const y = container.clientHeight / 2 / view.scale - view.translate.y - entry.h / 2 + step;
      return handle.insertNode(type, Math.round(x / 10) * 10, Math.round(y / 10) * 10, null);
    },
    setAttrs(cell, patch) {
      graph.batchUpdate(() => graph.getDataModel().setValue(cell, withAttrs(cell, patch)));
    },
    setNodeType(cell, type) {
      graph.batchUpdate(() => {
        graph.getDataModel().setValue(cell, withAttrs(cell, { umlType: type }));
        graph.setCellStyle({ baseStyleNames: [styleName(type)] }, [cell]);
      });
    },
    setEdgeType(cell, type) {
      graph.batchUpdate(() => {
        graph.getDataModel().setValue(cell, withAttrs(cell, { umlType: type }));
        graph.setCellStyle({ baseStyleNames: [styleName(type)] }, [cell]);
      });
    },
    editable,
    deleteSelection: () => {
      if (!editable.current) return;
      // No argument means "the deletable cells in the selection", and the
      // default includes every edge attached to them -- dangling edges are
      // disallowed, so a shape's connectors must go with it. Children go too,
      // which is what deleting a package or a swimlane should mean.
      graph.removeCells();
      container.focus({ preventScroll: true });
    },
    zoomTo: (scale) => graph.zoomTo(scale, true),
    restyle(theme) {
      applyUmlTheme(theme);
      applyGraphChrome();
      registerUmlStyles(graph.getStylesheet());
      if (connection) connection.connectImage = new ImageBox(connectIcon(), 16, 16);
      // Cells reference styles by name, so clearing the view's cached states
      // and revalidating is enough -- no cell is touched and nothing is dirtied.
      graph.getView().clear(graph.getDataModel().getRoot(), true, true);
      graph.getView().validate();
    },
    dispose() {
      resizeObserver.disconnect();
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("pointerdown", focusCanvas, true);
      graph.getDataModel().removeListener(undoListener);
      graph.getView().removeListener(undoListener);
      keys.onDestroy();
      undoManager.clear();
      graph.destroy();
      container.replaceChildren();
    },
  };
  return handle;
}
