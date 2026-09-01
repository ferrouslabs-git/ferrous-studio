// Every cell's value is a small XML element -- the "user object" pattern --
// so the UML type and text live as attributes that the model codec writes
// out and reads back unchanged.
import { Cell, xmlUtils } from "@maxgraph/core";
import { UML_ATTR } from "./umlTypes";

export interface UmlAttrs {
  umlType: string;
  label: string;
  stereotype: string;
  text: string;
  attributes: string;
  operations: string;
}

const EMPTY: UmlAttrs = { umlType: "", label: "", stereotype: "", text: "", attributes: "", operations: "" };
const KEYS = Object.keys(EMPTY) as (keyof UmlAttrs)[];

let doc: XMLDocument | null = null;
function document_(): XMLDocument {
  if (!doc) doc = xmlUtils.createXmlDocument();
  return doc;
}

export function createUserObject(type: string, attrs: Partial<Omit<UmlAttrs, "umlType">> = {}): Element {
  const el = document_().createElement("uml");
  el.setAttribute(UML_ATTR, type);
  for (const key of KEYS) {
    if (key === "umlType") continue;
    const value = attrs[key];
    if (value) el.setAttribute(key, value);
  }
  return el;
}

export function isUmlCell(cell: Cell | null | undefined): boolean {
  const v = cell?.value;
  return !!v && typeof v === "object" && "getAttribute" in v && !!(v as Element).getAttribute(UML_ATTR);
}

export function readUml(cell: Cell): UmlAttrs {
  if (!isUmlCell(cell)) return { ...EMPTY };
  const el = cell.value as Element;
  const out = { ...EMPTY };
  for (const key of KEYS) out[key] = el.getAttribute(key) ?? "";
  return out;
}

/** A modified copy of the cell's user object (the model sets it, so it is undoable). */
export function withAttrs(cell: Cell, patch: Partial<UmlAttrs>): Element {
  const el = (cell.value as Element).cloneNode(true) as Element;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (value) el.setAttribute(key, value);
    else el.removeAttribute(key);
  }
  return el;
}
