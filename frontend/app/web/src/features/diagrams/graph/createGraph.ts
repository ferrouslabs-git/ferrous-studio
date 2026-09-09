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
  ConnectionConstraint,
  ConnectionHandler,
  FitPlugin,
  Geometry,
  ImageBox,
  InternalEvent,
  KeyHandler,
  PanningHandler,
  Point,
  RubberBandHandler,
  SelectionCellsHandler,
  SelectionHandler,
  TooltipHandler,
  UndoManager,
  type EventObject,
} from "@maxgraph/core";
import { ArrowEnd, ArrowKind, withArrow } from "./arrows";
import { boundsOrigin, cellsToCopy, decodeCells, encodeCells, readClipboard, writeClipboard } from "./clipboard";
import { applyGraphChrome, registerStyleElements } from "./registerStyleElements";
import { ACCENT, applyUmlTheme, CANVAS_BG, currentUmlTheme, registerUmlStyles, styleName, UmlTheme } from "./umlStyles";
import { EDGE_BY_TYPE, hasCompartments, isEdgeType, NODE_BY_TYPE, noteBody, UmlEdgeType, UmlNodeType } from "./umlTypes";
import { createUserObject, isUmlCell, readUml, withAttrs } from "./userObject";

/** Where a cell should move in the paint order of its siblings. */
export type OrderHow = "front" | "forward" | "backward" | "back";

export interface GraphHandle {
  graph: BaseGraph;
  undoManager: UndoManager;
  insertNode(type: UmlNodeType, x: number, y: number, target?: Cell | null): Cell;
  insertNodeAtCentre(type: UmlNodeType): Cell;
  setAttrs(cell: Cell, patch: Record<string, string>): void;
  setNodeType(cell: Cell, type: UmlNodeType): void;
  setEdgeType(cell: Cell, type: UmlEdgeType): void;
  /** Put an arrowhead on one end of a connector, or hand the end back to its type. */
  setArrow(cell: Cell, end: ArrowEnd, kind: ArrowKind): void;
  /** Whether the diagram may be modified; the keyboard bindings respect it. */
  editable: { current: boolean };
  /** Remove the selected cells and the connectors attached to them. */
  deleteSelection(): void;
  /** Move the selection through the paint order of its siblings. */
  order(how: OrderHow): void;
  /** Put the selection on the clipboard; false when there was nothing to take. */
  copySelection(): boolean;
  cutSelection(): void;
  /** Drop the clipboard onto the canvas, under the pointer where there is one. */
  paste(): void;
  /** Fires when this editor changes the clipboard, so the UI can offer Paste. */
  onClipboardChange: { current: (() => void) | null };
  /** The container a drop at these container-relative pixels would land in. */
  dropTargetAt(x: number, y: number): Cell;
  zoomTo(scale: number): void;
  onSave: { current: (() => void) | null };
  /** Repaint every cell in the given theme; cells keep their named styles. */
  restyle(theme: UmlTheme): void;
  dispose(): void;
}

/**
 * The eight places a connector can be anchored to a shape: its corners and
 * the middle of each side, as fractions of its bounds. `perimeter` projects
 * them onto the outline, so a corner of an ellipse or a stencil sits on the
 * curve rather than floating outside it.
 */
const PORTS: ConnectionConstraint[] = [
  [0, 0],
  [0.5, 0],
  [1, 0],
  [0, 0.5],
  [1, 0.5],
  [0, 1],
  [0.5, 1],
  [1, 1],
].map(([x, y]) => new ConnectionConstraint(new Point(x, y), true));

const PORT_PX = 11;

/** A port handle: an accent dot punched out of the canvas, like the resize grips. */
const portIcon = () =>
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${PORT_PX}" height="${PORT_PX}" viewBox="0 0 ${PORT_PX} ${PORT_PX}"><circle cx="5.5" cy="5.5" r="4.25" fill="${ACCENT}" stroke="${CANVAS_BG}" stroke-width="1.5"/></svg>`,
  );

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** The note's body, as HTML: escaped, with its line breaks kept. */
function noteHtml(cell: Cell): string {
  return `<div class="uml-note-text">${escapeHtml(noteBody(readUml(cell))).replace(/\n/g, "<br/>")}</div>`;
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

  // Labels come from the user object. A note is nothing but its body text, so
  // it reads through to where older notes kept that.
  const bodyOf = (cell: Cell): string => {
    const a = readUml(cell);
    return a.umlType === "note" ? noteBody(a) : a.label;
  };
  graph.isHtmlLabel = (cell) => {
    if (!isUmlCell(cell)) return false;
    const type = readUml(cell).umlType;
    return hasCompartments(type) || type === "note";
  };
  graph.getLabel = (cell) => {
    if (!cell || !isUmlCell(cell)) return "";
    const a = readUml(cell);
    if (hasCompartments(a.umlType)) return compartmentHtml(cell);
    if (a.umlType === "note") return noteHtml(cell);
    if (cell.isEdge() && !a.label && isEdgeType(a.umlType) && EDGE_BY_TYPE[a.umlType].stereotype) {
      return `«${EDGE_BY_TYPE[a.umlType].stereotype}»`;
    }
    return bodyOf(cell);
  };
  graph.convertValueToString = (cell) => (isUmlCell(cell) ? bodyOf(cell) : "");
  graph.getEditingValue = (cell) => (isUmlCell(cell) ? bodyOf(cell) : "");
  graph.cellLabelChanged = (cell, value) => {
    if (!isUmlCell(cell)) return;
    // Writing a note's body retires the attribute the old shape kept it in.
    const patch = readUml(cell).umlType === "note" ? { label: String(value ?? ""), text: "" } : { label: String(value ?? "") };
    graph.batchUpdate(() => {
      graph.getDataModel().setValue(cell, withAttrs(cell, patch));
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

  // Connectors are drawn from one of a shape's eight port handles, the way
  // diagrams.net does it. Hovering an unselected shape shows its ports; a
  // drag that starts on one draws a connector, and a drag that starts
  // anywhere else on the shape moves it. A selected shape shows its resize
  // grips in those same eight places instead, so its ports stay hidden and
  // the grips win. Dropping on one of the target's ports pins that end there
  // (exitX/Y, entryX/Y on the edge's style); dropping on its body leaves the
  // end floating, so it slides round the outline as the shapes move.
  graph.getAllConnectionConstraints = (terminal) =>
    terminal && terminal.cell.isVertex() && terminal.cell.isConnectable() ? PORTS : null;

  // A new connector is a plain association; the inspector retypes it.
  const connection = graph.getPlugin<ConnectionHandler>(ConnectionHandler.pluginId);
  const ports = connection?.constraintHandler ?? null;
  if (connection && ports) {
    // No centre connect icon: the ports are the only way in.
    connection.connectImage = null;
    connection.select = true;
    connection.factoryMethod = () => makeEdge("association");
    ports.pointImage = new ImageBox(portIcon(), PORT_PX, PORT_PX);
    ports.highlightColor = ACCENT;
    connection.isStartEvent = () => !!ports.currentFocus && !!ports.currentConstraint;
    // Without a connect image the handler would otherwise light up a hovered
    // shape's centre as somewhere to start dragging from -- it is not.
    connection.isValidSource = () => false;
    // No ports on a selected shape (as a source; a selected target still
    // offers them while a connector is being dragged onto it).
    ports.isStateIgnored = (state, source) => !!source && graph.isCellSelected(state.cell);
  }
  // Selecting the shape under the pointer must take its ports away at once,
  // not on the next hover, or the first drag on a fresh selection's corner
  // grip would still draw a connector.
  const onSelectionChange = () => {
    if (!ports) return;
    if (ports.currentFocus && ports.isStateIgnored(ports.currentFocus, true)) {
      ports.currentFocus = null;
      ports.constraints = null;
      ports.destroyIcons();
    }
    ports.destroyFocusHighlight();
  };
  graph.getSelectionModel().addListener(InternalEvent.CHANGE, onSelectionChange);

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

  // Where the pointer last was, so a paste can land under it. Kept in both
  // coordinate systems: graph units place the cells, container pixels ask
  // getCellAt what they would be dropped into.
  const pointer = { x: 0, y: 0, px: 0, py: 0, inside: false };
  const onPointerMove = (e: PointerEvent) => {
    const point = graph.getPointForEvent(e, false);
    const rect = container.getBoundingClientRect();
    pointer.x = point.x;
    pointer.y = point.y;
    pointer.px = e.clientX - rect.left;
    pointer.py = e.clientY - rect.top;
    pointer.inside = true;
  };
  const onPointerLeave = () => {
    pointer.inside = false;
  };
  container.addEventListener("pointermove", onPointerMove);
  container.addEventListener("pointerleave", onPointerLeave);

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
  keys.bindControlKey(67, () => handle.copySelection());
  keys.bindControlKey(88, () => handle.cutSelection());
  keys.bindControlKey(86, () => handle.paste());
  // Ctrl+] / Ctrl+[ nudge through the stack, with shift for all the way.
  keys.bindControlKey(221, () => handle.order("forward"));
  keys.bindControlKey(219, () => handle.order("backward"));
  keys.bindControlShiftKey(221, () => handle.order("front"));
  keys.bindControlShiftKey(219, () => handle.order("back"));
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

  const onClipboardChange = { current: null as (() => void) | null };

  /**
   * Where the next paste lands, in graph units. Under the pointer when it is
   * over the canvas -- pasting is a placement gesture, so it should arrive
   * where you are looking -- and in the middle of the view when it is not (a
   * keyboard paste, or the pointer parked on the palette). Pasting twice onto
   * the same spot cascades, so the second copy cannot hide under the first.
   */
  let lastPaste: { x: number; y: number; repeats: number } | null = null;
  function pasteOrigin(): { x: number; y: number; px: number; py: number } {
    const view = graph.getView();
    const at = pointer.inside
      ? { x: pointer.x, y: pointer.y, px: pointer.px, py: pointer.py }
      : {
          x: graph.snap(container.clientWidth / 2 / view.scale - view.translate.x),
          y: graph.snap(container.clientHeight / 2 / view.scale - view.translate.y),
          px: container.clientWidth / 2,
          py: container.clientHeight / 2,
        };
    lastPaste = lastPaste && lastPaste.x === at.x && lastPaste.y === at.y ? { ...lastPaste, repeats: lastPaste.repeats + 1 } : { x: at.x, y: at.y, repeats: 0 };
    const step = lastPaste.repeats * 20;
    return { ...at, x: at.x + step, y: at.y + step };
  }

  const handle: GraphHandle = {
    graph,
    undoManager,
    onSave,
    onClipboardChange,
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
    // setCellStyle replaces the whole style, so the rest of it -- the port
    // anchors on a connector -- is carried across by hand.
    setNodeType(cell, type) {
      graph.batchUpdate(() => {
        graph.getDataModel().setValue(cell, withAttrs(cell, { umlType: type }));
        graph.setCellStyle({ ...cell.style, baseStyleNames: [styleName(type)] }, [cell]);
      });
    },
    setEdgeType(cell, type) {
      graph.batchUpdate(() => {
        graph.getDataModel().setValue(cell, withAttrs(cell, { umlType: type }));
        graph.setCellStyle({ ...cell.style, baseStyleNames: [styleName(type)] }, [cell]);
      });
    },
    setArrow(cell, end, kind) {
      graph.batchUpdate(() => graph.setCellStyle(withArrow(cell.style, end, kind), [cell]));
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
    dropTargetAt(x, y) {
      let cell: Cell | null = graph.getCellAt(x, y);
      while (cell) {
        const type = readUml(cell).umlType;
        if (type in NODE_BY_TYPE && NODE_BY_TYPE[type as UmlNodeType].container) return cell;
        cell = cell.getParent();
      }
      return graph.getDefaultParent();
    },
    order(how) {
      if (!editable.current) return;
      // Paint order is sibling order in the model, so this is a reshuffle of
      // each cell's index under its own parent -- a shape inside a swimlane
      // moves through that lane, not over the whole canvas.
      const cells = graph.getSelectionCells().filter((cell) => !!cell.getParent());
      if (!cells.length) return;
      const model = graph.getDataModel();
      const indexOf = (cell: Cell) => cell.getParent()!.getIndex(cell);
      const lowestFirst = [...cells].sort((a, b) => indexOf(a) - indexOf(b));
      graph.batchUpdate(() => {
        if (how === "front" || how === "back") {
          // orderCells restacks in the order it is given, so it must be sorted.
          graph.orderCells(how === "back", lowestFirst);
          return;
        }
        const step = how === "forward" ? 1 : -1;
        // Move the cell nearest the destination first, so a multiple selection
        // keeps its own stacking order instead of collapsing into it.
        for (const cell of step > 0 ? [...lowestFirst].reverse() : lowestFirst) {
          const parent = cell.getParent()!;
          const index = parent.getIndex(cell);
          const next = Math.min(Math.max(index + step, 0), parent.getChildCount() - 1);
          if (next !== index) model.add(parent, cell, next);
        }
      });
    },
    copySelection() {
      const cells = cellsToCopy(graph.getSelectionCells());
      if (!cells.length) return false;
      writeClipboard(encodeCells(graph, cells));
      onClipboardChange.current?.();
      return true;
    },
    cutSelection() {
      if (!editable.current) return;
      if (handle.copySelection()) handle.deleteSelection();
    },
    paste() {
      if (!editable.current) return;
      const xml = readClipboard();
      if (!xml) return;
      let cells: Cell[] = [];
      try {
        cells = decodeCells(xml);
      } catch {
        return;
      }
      if (!cells.length) return;
      const origin = boundsOrigin(cells);
      const at = pasteOrigin();
      const target = handle.dropTargetAt(at.px, at.py);
      let pasted: Cell[] = [];
      graph.batchUpdate(() => {
        pasted = graph.importCells(cells, at.x - origin.x, at.y - origin.y, target);
      });
      graph.setSelectionCells(pasted);
      container.focus({ preventScroll: true });
    },
    zoomTo: (scale) => graph.zoomTo(scale, true),
    restyle(theme) {
      applyUmlTheme(theme);
      applyGraphChrome();
      registerUmlStyles(graph.getStylesheet());
      if (ports) ports.pointImage = new ImageBox(portIcon(), PORT_PX, PORT_PX);
      // Cells reference styles by name, so clearing the view's cached states
      // and revalidating is enough -- no cell is touched and nothing is dirtied.
      graph.getView().clear(graph.getDataModel().getRoot(), true, true);
      graph.getView().validate();
    },
    dispose() {
      resizeObserver.disconnect();
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("pointerdown", focusCanvas, true);
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerleave", onPointerLeave);
      graph.getDataModel().removeListener(undoListener);
      graph.getView().removeListener(undoListener);
      graph.getSelectionModel().removeListener(onSelectionChange);
      keys.onDestroy();
      undoManager.clear();
      graph.destroy();
      container.replaceChildren();
    },
  };
  return handle;
}
