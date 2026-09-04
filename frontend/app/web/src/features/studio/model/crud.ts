// The CRUD recipe: the pure half of "turn this list into a working CRUD
// prototype". Everything here is a data transform — no React, no network — so
// the shape of what one click produces is unit-testable on its own.
//
// The recipe deliberately writes only to a component's `elements` and
// `props.links`, never to its `shape`. A list keeps its CRUD wiring when the
// user switches it between table, cards, rows and feed.
import { ElementSeed } from "../catalog";
import { componentTitle, elementLink, elKey, LinksProp } from "./actions";
import { reposition } from "./positions";
import { getDefaultProps, makeElement, uid } from "./regions";
import { blankDocument } from "./tree";
import { BACK_PAGE_ID, ComponentNode, ElementNode, PageDocument } from "./types";

/** The seeded platform dataset a CRUD list's status filter binds to. Fixed id,
 *  matching alembic `a7c2e5d9f314` — keep them in step. A platform admin can
 *  delete the row, so callers must fall back to FILTER_FALLBACK_OPTIONS when it
 *  no longer resolves. */
export const RECORD_STATUS_DATASET_ID = "6f1a2b3c-0009-4d5e-8f00-a1b2c3d4e509";
export const FILTER_FALLBACK_OPTIONS = "Active, Archived, All";
export const FILTER_LABEL = "Status";
export const FILTER_DEFAULT = "Active";

export const EDIT_ACTION_LABEL = "Edit";
export const ARCHIVE_ACTION_LABEL = "Archive";

/** Above this many fields a drawer's form goes two-column: a side sheet is the
 *  wrong home for a long single-column form. */
export const TWO_COLUMN_THRESHOLD = 6;

/** The `column` elements a list shows, in document order. Action columns are
 *  not data, so they never become form fields. */
export const dataColumns = (list: ComponentNode): ElementNode[] =>
  (list.elements ?? []).filter((e) => e.type === "column" && e.data?.kind !== "actions");

/** The form element a list column becomes in the edit drawer, or null for a
 *  column that stands for something other than a value.
 *
 *  A column already bound to a dataset yields a dropdown bound to the SAME
 *  dataset, so the form offers exactly the values the list displays. */
export function fieldSeedForColumn(col: ElementNode): ElementSeed | null {
  if (col.type !== "column") return null;
  const label = col.label;
  const kind = col.data?.kind ?? "text";
  if (kind === "actions") return null;

  const dataset = col.data?.dataset;
  if (dataset) return { type: "select", label, data: { dataset } };

  switch (kind) {
    case "status":
      // The column's own samples are the closest thing to its value set.
      return { type: "select", label, data: { options: col.data?.samples || "Active, Archived" } };
    case "boolean":
      return { type: "toggle", label };
    case "date":
      return { type: "date-picker", label };
    case "image":
      return { type: "file-upload", label };
    case "email":
    case "phone":
    case "url":
    case "number":
      return { type: "text-input", label, data: { kind } };
    case "currency":
    case "percentage":
      return { type: "text-input", label, data: { kind: "number" } };
    default:
      // text, person, tags, time — a plain line of text stands in fine.
      return { type: "text-input", label, data: { kind: "text" } };
  }
}

/** A component built from an explicit element list, with none of the type's
 *  own default elements — `defaultElementsFor` would prepend the form's stock
 *  Name/Email/Role/Team/Cancel/Save, which is not what a generated form wants.
 *  Every button it ends up with links back to wherever the page was opened
 *  from, which is how a drawer's Cancel and Save both behave. */
function formComponent(type: string, label: string, layout: string, seeds: ElementSeed[]): ComponentNode {
  const elements: ElementNode[] = [];
  for (const seed of seeds) {
    const node = makeElement(type, seed);
    if (node) elements.push(node);
  }
  reposition(elements);

  const links: LinksProp = {};
  for (const e of elements) if (e.type === "button") links[elKey(e.id)] = { pageId: BACK_PAGE_ID };

  return {
    id: uid("c"),
    type,
    label,
    pos: "a0",
    shape: "simple",
    layout,
    elements,
    props: { ...getDefaultProps(type), links },
  };
}

/** What the edit drawer is called: "Edit Users" for a list titled Users. */
export const editPageName = (list: ComponentNode): string => `Edit ${componentTitle(list) || "record"}`.trim();

/** The whole drawer page: a form whose inputs mirror the list's columns, and
 *  Cancel / Save buttons that return to the page it was opened from. */
export function buildEditDocument(list: ComponentNode, regionLabel: string): PageDocument {
  const title = editPageName(list);
  const fields = dataColumns(list)
    .map(fieldSeedForColumn)
    .filter((s): s is ElementSeed => s !== null);

  const seeds: ElementSeed[] = [
    { type: "header", label: title },
    ...fields,
    { type: "button", label: "Cancel", data: { style: "secondary" } },
    { type: "button", label: "Save", data: { style: "primary" } },
  ];

  const doc = blankDocument(regionLabel);
  doc.regions[doc.root.id] = [
    formComponent("form", title, fields.length > TWO_COLUMN_THRESHOLD ? "two-column" : "one-column", seeds),
  ];
  return doc;
}

// ── Re-running the recipe ───────────────────────────────────────────────────

const rowActionNamed = (list: ComponentNode, label: string): ElementNode | undefined =>
  (list.elements ?? []).find((e) => e.type === "row-action" && e.label.trim().toLowerCase() === label.toLowerCase());

/** Which parts of the recipe this list still needs.
 *
 *  The recipe is additive but non-duplicating: clicking CRUD a second time
 *  must not stack up a second Edit action or a second status filter. An Edit
 *  action counts as done only when it actually carries a link — an action
 *  someone labelled "Edit" by hand, or one whose drawer they later deleted,
 *  still wants wiring up. Archive and the filter have no link to check, so a
 *  matching element is enough. */
export function crudGaps(list: ComponentNode): { edit: boolean; archive: boolean; filter: boolean } {
  const edit = rowActionNamed(list, EDIT_ACTION_LABEL);
  return {
    edit: !edit || !elementLink(list, elKey(edit.id), null),
    archive: !rowActionNamed(list, ARCHIVE_ACTION_LABEL),
    filter: !(list.elements ?? []).some((e) => e.type === "filter"),
  };
}

/** Why the CRUD button is unavailable, or null when it can run. */
export function crudDisabledReason(list: ComponentNode | null): string | null {
  if (!list || list.type !== "list") return "Select a list first";
  if (dataColumns(list).length === 0) return "Add a column to the list first";
  return null;
}
