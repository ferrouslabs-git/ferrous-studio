// Drag payload helpers. Same MIME type and shapes as the legacy builder so
// the semantics are unchanged: patterns and components are copied from the
// library, components on the canvas are reordered.
import { DragEvent } from "react";
import { RegionName } from "../model/types";

export const MIME = "application/x-vsub";

export type DragPayload =
  | { kind: "pattern"; id: string }
  | { kind: "component"; type: string; customId?: string }
  | { kind: "reorder"; id: string };

export function setPayload(e: DragEvent, payload: DragPayload, effect: "copy" | "move"): void {
  e.dataTransfer.effectAllowed = effect;
  e.dataTransfer.setData(MIME, JSON.stringify(payload));
}

export function hasPayload(e: DragEvent): boolean {
  return Array.from(e.dataTransfer.types ?? []).includes(MIME);
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

export type DropTarget = { region: RegionName | null; cmpId: string | null; before: boolean };
