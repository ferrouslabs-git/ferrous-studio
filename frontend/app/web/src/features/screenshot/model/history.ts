// Undo/redo for the annotation editor.
//
// Snapshots of the shape array rather than commands, for the reason
// features/studio/model/history.ts already gives: the arrays are tens of
// entries and every untouched shape is shared by reference, so a step costs one
// array of pointers. Commands would buy nothing and cost an inverse for each of
// five shape kinds.
//
// The commit discipline is ONE GESTURE, ONE ENTRY: a freehand drag pushes once
// on pointerup, not once per pointermove; a text edit pushes on blur or Enter;
// a drag-to-move pushes on drop. Undo should retrace what the user did, not
// what the browser reported.
import { Shape } from "./shapes";

/** Far more than anyone annotating a screenshot will use, and small enough
 *  that the whole stack is a rounding error against one ImageBitmap. */
export const HISTORY_LIMIT = 50;

export class ShapeHistory {
  private stack: Shape[][];
  private index: number;

  constructor(initial: Shape[] = []) {
    this.stack = [initial];
    this.index = 0;
  }

  get shapes(): readonly Shape[] {
    return this.stack[this.index];
  }

  canUndo(): boolean {
    return this.index > 0;
  }

  canRedo(): boolean {
    return this.index < this.stack.length - 1;
  }

  /** Record a new state. Discards any redo branch, as every editor does. */
  push(next: Shape[]): void {
    this.stack = [...this.stack.slice(0, this.index + 1), next];
    if (this.stack.length > HISTORY_LIMIT) {
      // Drop from the bottom: the oldest states are the ones nobody returns to.
      this.stack = this.stack.slice(this.stack.length - HISTORY_LIMIT);
    }
    this.index = this.stack.length - 1;
  }

  undo(): readonly Shape[] | null {
    if (!this.canUndo()) return null;
    this.index -= 1;
    return this.shapes;
  }

  redo(): readonly Shape[] | null {
    if (!this.canRedo()) return null;
    this.index += 1;
    return this.shapes;
  }

  /** Start again from `shapes`, forgetting the timeline. Used when the image
   *  itself is replaced (a second capture, or a pasted screenshot), where undo
   *  back into annotations of a different picture would be nonsense. */
  reset(shapes: Shape[] = []): void {
    this.stack = [shapes];
    this.index = 0;
  }
}
