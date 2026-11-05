// The exact object emitted to backend/app/studio/catalog.json -- everything
// the bundle validator needs to know about the canvas editor's vocabulary.
//
// Kept in its own module, not inline in scripts/emit-catalog.ts, so
// catalog.mirror.test.ts can import this same derivation and deep-equal it
// against the checked-in JSON: editing the catalogue without re-emitting
// then fails the frontend test suite instead of silently drifting from what
// the validator enforces.
//
// Only what the validator needs -- no labels, descriptions or icons.
import { COMPONENTS, DATA_KINDS, ElementRemap, NAV_ICONS, RENAMED_ELEMENT_DATA, RETIRED_ELEMENTS, RETIRED_TYPES } from "./catalog";
import { PRESENTATION_LABELS } from "./model/types";
import { EDGE_BY_TYPE, NODE_BY_TYPE } from "../diagrams/graph/umlTypes";

export interface NodeSizeMirror {
  w: number;
  h: number;
}

export interface CatalogElementMirror {
  /** The element's type (FS-REQ-84: text, input, action, ui, image, basic);
   *  the element's own id is its shape. */
  group: string;
  fields: string[];
  max: number | null;
  variantable: boolean;
  fillable: boolean;
}

export interface CatalogComponentMirror {
  shapes: string[];
  layouts: string[];
  elements: Record<string, CatalogElementMirror>;
}

export interface CatalogMirror {
  dataKinds: string[];
  inputKinds: string[];
  presentations: string[];
  retired: string[];
  umlNodeTypes: string[];
  umlEdgeTypes: string[];
  /** The palette's own default size per node type -- what a person dragging
   *  that shape onto a diagram gets, reused as the importer's grid_layout
   *  fallback so an ungeometried bundle node looks the same as a hand-drawn
   *  one of that type. */
  umlNodeDefaults: Record<string, NodeSizeMirror>;
  components: Record<string, CatalogComponentMirror>;
  /** Element shapes a host withdrew, and what a stored/imported one becomes
   *  (null: dropped). The importer applies these before validating. */
  retiredElements: Record<string, Record<string, ElementRemap | null>>;
  /** Element data keys renamed (old → new) in every host. */
  renamedElementData: Record<string, string>;
  /** The icon library's names (an icon element's data.icon). */
  icons: string[];
}

/** The "kind" field's own options on the form's text-input element -- the
 *  input-kind vocabulary is defined there, not as its own top-level const. */
function inputKinds(): string[] {
  const textInput = COMPONENTS.form?.elements.find((el) => el.type === "text-input");
  const kindField = textInput?.dataFields.find((f) => f.key === "kind");
  return [...(kindField?.options ?? [])];
}

export function buildCatalogMirror(): CatalogMirror {
  const components: Record<string, CatalogComponentMirror> = {};
  for (const [name, meta] of Object.entries(COMPONENTS)) {
    const elements: Record<string, CatalogElementMirror> = {};
    for (const el of meta.elements) {
      elements[el.type] = {
        group: el.group,
        fields: el.dataFields.map((f) => f.key),
        max: el.max ?? null,
        variantable: !!el.variantable,
        fillable: !!el.fillable,
      };
    }
    components[name] = {
      shapes: meta.shapes.map((s) => s.id),
      layouts: meta.layouts.map((l) => l.id),
      elements,
    };
  }

  return {
    dataKinds: [...DATA_KINDS],
    inputKinds: inputKinds(),
    presentations: Object.keys(PRESENTATION_LABELS),
    retired: [...RETIRED_TYPES].sort(),
    umlNodeTypes: Object.keys(NODE_BY_TYPE),
    umlEdgeTypes: Object.keys(EDGE_BY_TYPE),
    umlNodeDefaults: Object.fromEntries(
      Object.entries(NODE_BY_TYPE).map(([type, entry]) => [type, { w: entry.w, h: entry.h }]),
    ),
    components,
    retiredElements: RETIRED_ELEMENTS,
    renamedElementData: RENAMED_ELEMENT_DATA,
    icons: [...NAV_ICONS],
  };
}
