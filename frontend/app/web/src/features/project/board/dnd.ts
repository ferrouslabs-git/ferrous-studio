// Drag-and-drop hooks over Pragmatic drag and drop, which rides on the
// browser's native drag API -- the same interaction the reference app has
// (an epic row onto a release card, a requirement between the backlog and a
// sprint, a card between kanban lanes). The dragged entity travels as typed
// data; drop targets say what they accept and what to do with it. Every
// drag also has a single-pointer alternative on the row (⇄, →, ↩, ▲▼, ◀/▶),
// so a drop is never the only route.
import { draggable, dropTargetForElements, monitorForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { RefObject, useEffect, useRef, useState } from "react";

export type DragKind = "epic" | "requirement" | "card";

export interface DragData extends Record<string, unknown> {
  kind: DragKind;
  id: string;
  /** Where it came from (a sprint id, a lane), for targets that refuse a no-op drop. */
  from?: string | null;
}

const isDragData = (d: Record<string, unknown>): d is DragData => typeof d.kind === "string" && typeof d.id === "string";

// A drag that starts on a control inside the row (a button, a select, an
// input) is that control's gesture, not a drag of the row.
function startsOnControl(input: { clientX: number; clientY: number }): boolean {
  const el = document.elementFromPoint(input.clientX, input.clientY);
  return !!el?.closest("button, input, select, textarea, a, [contenteditable='true']");
}

/**
 * Makes ref's element draggable while data is non-null. data is read through
 * a ref (an inline object is fine), but the element must exist when the hook
 * is first enabled -- the subscription keys on the ref object, not the node.
 * A drag that starts on a control inside the element is refused. Returns true
 * while this element is being dragged.
 */
export function useDraggable(ref: RefObject<HTMLElement | null>, data: DragData | null): boolean {
  const [dragging, setDragging] = useState(false);
  const dataRef = useRef(data);
  dataRef.current = data;
  const enabled = data !== null;

  useEffect(() => {
    const element = ref.current;
    if (!element || !enabled) return;
    return draggable({
      element,
      getInitialData: () => dataRef.current ?? {},
      canDrag: ({ input }) => dataRef.current !== null && !startsOnControl(input),
      onDragStart: () => setDragging(true),
      onDrop: () => setDragging(false),
    });
  }, [ref, enabled]);

  return dragging;
}

export interface DropTargetOptions {
  accepts: (data: DragData) => boolean;
  onDrop: (data: DragData) => void;
  disabled?: boolean;
}

/**
 * Makes ref's element a drop target unless opts.disabled. accepts says whether
 * the dragged data may land here -- a refused drag never counts as over this
 * target and never reaches onDrop; onDrop then runs with that data when an
 * accepted drag is released on the element. Both are read through a ref
 * (inline closures are fine), but the element must exist when the hook is
 * first enabled -- the subscription keys on the ref object, not the node.
 * When targets nest, only the innermost accepting target under the pointer
 * acts. Returns true while an accepted drag is over this element.
 */
export function useDropTarget(ref: RefObject<HTMLElement | null>, opts: DropTargetOptions): boolean {
  const [over, setOver] = useState(false);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const disabled = !!opts.disabled;

  useEffect(() => {
    const element = ref.current;
    if (!element || disabled) return;
    return dropTargetForElements({
      element,
      canDrop: ({ source }) => isDragData(source.data) && optsRef.current.accepts(source.data),
      onDragEnter: () => setOver(true),
      onDragLeave: () => setOver(false),
      onDrop: ({ source, location }) => {
        setOver(false);
        // Only the innermost target acts, should targets ever nest.
        if (location.current.dropTargets[0]?.element !== element) return;
        if (isDragData(source.data)) optsRef.current.onDrop(source.data);
      },
    });
  }, [ref, disabled]);

  return over;
}

// Whether a drag of this kind is in flight anywhere on the page; also tags
// <body> with `board-dragging-<kind>` so board.css can outline every target.
export function useDragActive(kind: DragKind): boolean {
  const [active, setActive] = useState(false);
  useEffect(() => {
    const cls = `board-dragging-${kind}`;
    return monitorForElements({
      canMonitor: ({ source }) => isDragData(source.data) && source.data.kind === kind,
      onDragStart: () => {
        document.body.classList.add(cls);
        setActive(true);
      },
      onDrop: () => {
        document.body.classList.remove(cls);
        setActive(false);
      },
    });
  }, [kind]);
  return active;
}
