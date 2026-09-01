// Drag payload helpers. Same MIME type and shapes as the legacy builder so
// the semantics are unchanged: patterns and components are copied from the
// library, components on the canvas are reordered, elements are copied into
// a compatible component (never into a region).
import { DragEvent } from "react";

export const MIME = "application/x-vsub";
/** Element drags also advertise their element type as a MIME type NAME, so
 *  dragover — which cannot read payload data — can gate drop targets. */
const MIME_EL_PREFIX = "application/x-vsub-el--";

export type DragPayload =
  | { kind: "pattern"; id: string }
  | { kind: "component"; type: string; shape?: string; customId?: string }
  | { kind: "element"; type: string }
  | { kind: "reorder"; id: string };

export function setPayload(e: DragEvent, payload: DragPayload, effect: "copy" | "move"): void {
  e.dataTransfer.effectAllowed = effect;
  e.dataTransfer.setData(MIME, JSON.stringify(payload));
  if (payload.kind === "element") e.dataTransfer.setData(`${MIME_EL_PREFIX}${payload.type}`, "");
}

export function hasPayload(e: DragEvent): boolean {
  return Array.from(e.dataTransfer.types ?? []).includes(MIME);
}

/** The element type being dragged, readable during dragover; null otherwise. */
export function draggedElementType(e: DragEvent): string | null {
  for (const t of e.dataTransfer.types ?? []) {
    if (t.startsWith(MIME_EL_PREFIX)) return t.slice(MIME_EL_PREFIX.length);
  }
  return null;
}

export function readPayload(e: DragEvent): DragPayload | null {
  try {
    return JSON.parse(e.dataTransfer.getData(MIME)) as DragPayload;
  } catch {
    return null;
  }
}

/** Where a drop over an element lands relative to it. */
export function dropBefore(e: DragEvent, el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  return e.clientY - rect.top < rect.height / 2;
}

export interface DropHint {
  cmpId: string;
  before: boolean;
}

export type DropTarget = { region: string | null; cmpId: string | null; before: boolean };
