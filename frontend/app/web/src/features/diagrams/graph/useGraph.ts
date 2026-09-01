// Owns the graph's lifecycle on a container ref and mirrors the few facts
// React needs (selection, undo availability, zoom, a change counter) into
// state. The graph itself never lives in React state.
import { Cell, InternalEvent } from "@maxgraph/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { createDiagramGraph, GraphHandle } from "./createGraph";
import { currentUmlTheme } from "./umlStyles";
import { readUml, UmlAttrs } from "./userObject";

export interface Selection {
  cells: Cell[];
  /** The single selected cell's attributes, when exactly one is selected. */
  one: (UmlAttrs & { isEdge: boolean; cell: Cell }) | null;
}

export interface GraphState {
  ready: boolean;
  selection: Selection;
  canUndo: boolean;
  canRedo: boolean;
  scale: number;
  /** Increments on every model change made while not importing. */
  changeTick: number;
}

export function useGraph() {
  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<GraphHandle | null>(null);
  const importingRef = useRef(false);
  const [state, setState] = useState<GraphState>({
    ready: false,
    selection: { cells: [], one: null },
    canUndo: false,
    canRedo: false,
    scale: 1,
    changeTick: 0,
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handle = createDiagramGraph(container);
    handleRef.current = handle;
    const { graph, undoManager } = handle;

    const syncSelection = () => {
      const cells = graph.getSelectionCells();
      const one = cells.length === 1 ? { ...readUml(cells[0]), isEdge: cells[0].isEdge(), cell: cells[0] } : null;
      setState((s) => ({ ...s, selection: { cells, one } }));
    };
    const syncUndo = () => setState((s) => ({ ...s, canUndo: undoManager.canUndo(), canRedo: undoManager.canRedo() }));
    const syncScale = () => setState((s) => ({ ...s, scale: graph.getView().scale }));
    const onChange = () => {
      syncSelection();
      if (!importingRef.current) setState((s) => ({ ...s, changeTick: s.changeTick + 1 }));
    };

    graph.getSelectionModel().addListener(InternalEvent.CHANGE, syncSelection);
    graph.getDataModel().addListener(InternalEvent.CHANGE, onChange);
    undoManager.addListener(InternalEvent.ADD, syncUndo);
    undoManager.addListener(InternalEvent.UNDO, syncUndo);
    undoManager.addListener(InternalEvent.REDO, syncUndo);
    undoManager.addListener(InternalEvent.CLEAR, syncUndo);
    graph.getView().addListener(InternalEvent.SCALE, syncScale);
    graph.getView().addListener(InternalEvent.SCALE_AND_TRANSLATE, syncScale);

    // maxGraph paints to SVG with literal colours, so it cannot inherit the
    // theme from CSS. Watch the attribute the theme switch flips and repaint;
    // watching the DOM rather than React state keeps the editor independent of
    // wherever the switch happens to live.
    const themeObserver = new MutationObserver(() => handle.restyle(currentUmlTheme()));
    themeObserver.observe(document.documentElement, { attributeFilter: ["data-theme"] });

    setState((s) => ({ ...s, ready: true }));
    return () => {
      themeObserver.disconnect();
      handle.dispose();
      handleRef.current = null;
      setState((s) => ({ ...s, ready: false }));
    };
  }, []);

  /** Run an import without it counting as a user change. */
  const whileImporting = useCallback((fn: () => void) => {
    importingRef.current = true;
    try {
      fn();
    } finally {
      importingRef.current = false;
    }
  }, []);

  return { containerRef, handleRef, state, whileImporting };
}
