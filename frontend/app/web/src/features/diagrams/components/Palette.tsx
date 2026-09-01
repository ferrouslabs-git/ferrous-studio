// The shape palette. Each tile is draggable onto the canvas (maxGraph's
// makeDraggable) and clickable to insert at the viewport centre.
import { Cell, gestureUtils } from "@maxgraph/core";
import { useEffect, useRef } from "react";
import { GraphHandle } from "../graph/createGraph";
import { FAMILIES, PALETTE, PaletteEntry } from "../graph/umlTypes";
import { readUml } from "../graph/userObject";
import { NODE_BY_TYPE } from "../graph/umlTypes";

export function Palette({ handleRef, disabled }: { handleRef: React.MutableRefObject<GraphHandle | null>; disabled: boolean }) {
  return (
    <aside className="diagram-palette" aria-label="Shapes">
      {FAMILIES.map((family) => (
        <div key={family} className="palette-group">
          <div className="palette-title">{family}</div>
          <div className="palette-tiles">
            {PALETTE.filter((p) => p.family === family).map((entry) => (
              <Tile key={entry.type} entry={entry} handleRef={handleRef} disabled={disabled} />
            ))}
          </div>
        </div>
      ))}
    </aside>
  );
}

function Tile({ entry, handleRef, disabled }: { entry: PaletteEntry; handleRef: React.MutableRefObject<GraphHandle | null>; disabled: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || disabled) return;
    const preview = document.createElement("div");
    preview.className = "palette-drag-preview";
    preview.style.width = `${entry.w}px`;
    preview.style.height = `${entry.h}px`;

    const dropTarget = (graph: Parameters<typeof gestureUtils.makeDraggable>[1] extends infer G ? (G extends Function ? never : G) : never, x: number, y: number): Cell => {
      const hit = graph.getCellAt(x, y);
      let cursor: Cell | null = hit;
      while (cursor) {
        const t = readUml(cursor).umlType;
        if (t && NODE_BY_TYPE[t as keyof typeof NODE_BY_TYPE]?.container) return cursor;
        cursor = cursor.getParent();
      }
      return graph.getDefaultParent();
    };

    const source = gestureUtils.makeDraggable(
      el,
      () => handleRef.current!.graph,
      (_graph, _evt, target, x, y) => {
        handleRef.current?.insertNode(entry.type, Math.round((x ?? 0) / 10) * 10, Math.round((y ?? 0) / 10) * 10, target);
      },
      preview,
      null,
      null,
      true,
      true,
      true,
      (graph, x, y) => dropTarget(graph as never, x, y),
    );
    source.setGuidesEnabled(true);
    return () => {
      source.dragElement = null;
      source.removeDragElement?.();
    };
  }, [entry, handleRef, disabled]);

  return (
    <button
      ref={ref}
      type="button"
      className="palette-tile"
      title={`${entry.label} — drag onto the canvas or click to insert`}
      disabled={disabled}
      onClick={() => handleRef.current?.insertNodeAtCentre(entry.type)}
    >
      <span className="palette-glyph" aria-hidden="true">
        {entry.glyph}
      </span>
      <span className="palette-label">{entry.label}</span>
    </button>
  );
}
