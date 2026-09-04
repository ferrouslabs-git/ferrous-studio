import { describe, expect, it } from "vitest";
import { DATA_KINDS } from "../catalog";
import {
  ARCHIVE_ACTION_LABEL,
  buildEditDocument,
  crudDisabledReason,
  crudGaps,
  dataColumns,
  EDIT_ACTION_LABEL,
  editPageName,
  fieldSeedForColumn,
  TWO_COLUMN_THRESHOLD,
} from "./crud";
import { elKey } from "./actions";
import { BACK_PAGE_ID, ComponentNode, ElementNode } from "./types";

const el = (id: string, type: string, label: string, pos: string, data?: Record<string, string>): ElementNode =>
  data ? { id, type, label, pos, data } : { id, type, label, pos };

const col = (id: string, label: string, data?: Record<string, string>): ElementNode =>
  el(id, "column", label, id, { kind: "text", ...data });

const list = (elements: ElementNode[], label = "Users"): ComponentNode => ({
  id: "c1",
  type: "list",
  label,
  pos: "a0",
  shape: "table",
  elements,
});

/** The single form component a built drawer document contains. */
const formOf = (doc: ReturnType<typeof buildEditDocument>): ComponentNode =>
  doc.regions[doc.root.id][0];

describe("fieldSeedForColumn", () => {
  it("maps each data kind to a sensible input", () => {
    const cases: [string, string][] = [
      ["text", "text-input"],
      ["number", "text-input"],
      ["date", "date-picker"],
      ["time", "text-input"],
      ["email", "text-input"],
      ["phone", "text-input"],
      ["currency", "text-input"],
      ["percentage", "text-input"],
      ["status", "select"],
      ["person", "text-input"],
      ["tags", "text-input"],
      ["image", "file-upload"],
      ["boolean", "toggle"],
      ["url", "text-input"],
    ];
    for (const [kind, type] of cases) {
      expect(fieldSeedForColumn(col("e1", "Field", { kind }))?.type, kind).toBe(type);
    }
  });

  it("covers every kind in the catalogue", () => {
    // A new DataKind must be given a home here rather than silently falling
    // through to a text input by accident.
    for (const kind of DATA_KINDS) {
      const seed = fieldSeedForColumn(col("e1", "Field", { kind }));
      if (kind === "actions") expect(seed).toBeNull();
      else expect(seed, kind).not.toBeNull();
    }
  });

  it("carries the matching input kind through for typed text fields", () => {
    expect(fieldSeedForColumn(col("e1", "Email", { kind: "email" }))?.data).toEqual({ kind: "email" });
    expect(fieldSeedForColumn(col("e1", "Paid", { kind: "currency" }))?.data).toEqual({ kind: "number" });
  });

  it("rebinds a dataset-bound column to the same dataset", () => {
    const seed = fieldSeedForColumn(col("e1", "Role", { kind: "text", dataset: "ds-7" }));
    expect(seed).toEqual({ type: "select", label: "Role", data: { dataset: "ds-7" } });
  });

  it("seeds a status dropdown from the column's own samples", () => {
    const seed = fieldSeedForColumn(col("e1", "State", { kind: "status", samples: "Live, Paused" }));
    expect(seed?.data).toEqual({ options: "Live, Paused" });
  });

  it("skips action columns and non-column elements", () => {
    expect(fieldSeedForColumn(col("e1", "", { kind: "actions" }))).toBeNull();
    expect(fieldSeedForColumn(el("e2", "row-action", "Edit", "a0"))).toBeNull();
    // An action column is skipped even when something bound it to a dataset.
    expect(fieldSeedForColumn(col("e3", "", { kind: "actions", dataset: "ds-7" }))).toBeNull();
  });
});

describe("dataColumns", () => {
  it("keeps only real columns, in document order", () => {
    const c = list([
      el("e0", "header", "Users", "a0"),
      col("e1", "Name"),
      el("e2", "row-action", "Edit", "a2"),
      col("e3", "", { kind: "actions" }),
      col("e4", "Email", { kind: "email" }),
    ]);
    expect(dataColumns(c).map((x) => x.label)).toEqual(["Name", "Email"]);
  });
});

describe("buildEditDocument", () => {
  const threeCols = list([col("e1", "Name"), col("e2", "Email", { kind: "email" }), col("e3", "Joined", { kind: "date" })]);

  it("names the page after the list", () => {
    expect(editPageName(threeCols)).toBe("Edit Users");
    // A header element wins over the component label (componentTitle's rule).
    expect(editPageName(list([el("e0", "header", "Team members", "a0"), col("e1", "Name")]))).toBe("Edit Team members");
  });

  it("builds one input per data column, plus a header and two buttons", () => {
    const form = formOf(buildEditDocument(threeCols, "Users > Edit"));
    expect(form.type).toBe("form");
    expect(form.shape).toBe("simple");
    expect(form.elements?.map((e) => e.type)).toEqual([
      "header",
      "text-input",
      "text-input",
      "date-picker",
      "button",
      "button",
    ]);
    expect(form.elements?.map((e) => e.label)).toEqual(["Edit Users", "Name", "Email", "Joined", "Cancel", "Save"]);
  });

  it("carries none of the form type's own default elements", () => {
    // defaultElementsFor would prepend Name/Email/Role/Team/Cancel/Save.
    const form = formOf(buildEditDocument(list([col("e1", "Reference")]), "R"));
    expect(form.elements?.filter((e) => e.type === "text-input").map((e) => e.label)).toEqual(["Reference"]);
  });

  it("links both buttons back to the page the drawer was opened from", () => {
    const form = formOf(buildEditDocument(threeCols, "Users > Edit"));
    const buttons = form.elements!.filter((e) => e.type === "button");
    const links = form.props!.links as Record<string, { pageId: string }>;
    expect(Object.keys(links)).toHaveLength(2);
    for (const b of buttons) expect(links[elKey(b.id)]).toEqual({ pageId: BACK_PAGE_ID });
  });

  it("mints fresh element ids and strictly increasing positions", () => {
    const form = formOf(buildEditDocument(threeCols, "Users > Edit"));
    const ids = form.elements!.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    const pos = form.elements!.map((e) => e.pos);
    expect([...pos].sort()).toEqual(pos);
  });

  it("puts the form in the document's own region, labelled as asked", () => {
    const doc = buildEditDocument(threeCols, "Users > Edit");
    expect(doc.root.kind).toBe("region");
    expect(doc.root.kind === "region" && doc.root.label).toBe("Users > Edit");
    expect(doc.regions[doc.root.id]).toHaveLength(1);
  });

  const columns = (n: number) => Array.from({ length: n }, (_, i) => col(`e${i}`, `Field ${i}`));

  it("stays one-column at the threshold and goes two-column above it", () => {
    expect(formOf(buildEditDocument(list(columns(TWO_COLUMN_THRESHOLD)), "R")).layout).toBe("one-column");
    expect(formOf(buildEditDocument(list(columns(TWO_COLUMN_THRESHOLD + 1)), "R")).layout).toBe("two-column");
  });
});

describe("crudGaps", () => {
  const withEdit = (linked: boolean): ComponentNode => {
    const c = list([col("e1", "Name"), el("ea", "row-action", "Edit", "a1")]);
    if (linked) c.props = { links: { [elKey("ea")]: { pageId: "p-1" } } };
    return c;
  };

  it("reports everything missing on a bare list", () => {
    expect(crudGaps(list([col("e1", "Name")]))).toEqual({ edit: true, archive: true, filter: true });
  });

  it("treats an unlinked Edit action as still needing wiring", () => {
    expect(crudGaps(withEdit(false)).edit).toBe(true);
  });

  it("leaves a linked Edit action alone", () => {
    expect(crudGaps(withEdit(true)).edit).toBe(false);
  });

  it("matches action labels case-insensitively", () => {
    const c = list([col("e1", "Name"), el("ea", "row-action", "  archive  ", "a1")]);
    expect(crudGaps(c).archive).toBe(false);
  });

  it("counts any filter as the status filter", () => {
    const c = list([col("e1", "Name"), el("ef", "filter", "Owner", "a1")]);
    expect(crudGaps(c).filter).toBe(false);
  });

  it("so a second run adds nothing to a fully built list", () => {
    const c = list([
      col("e1", "Name"),
      el("ea", "row-action", EDIT_ACTION_LABEL, "a1"),
      el("eb", "row-action", ARCHIVE_ACTION_LABEL, "a2"),
      el("ef", "filter", "Status", "a3"),
    ]);
    c.props = { links: { [elKey("ea")]: { pageId: "p-1" } } };
    expect(crudGaps(c)).toEqual({ edit: false, archive: false, filter: false });
  });
});

describe("crudDisabledReason", () => {
  it("refuses a list with no data columns", () => {
    expect(crudDisabledReason(list([]))).toBe("Add a column to the list first");
    expect(crudDisabledReason(list([col("e1", "", { kind: "actions" })]))).toBe("Add a column to the list first");
  });

  it("refuses anything that is not a list", () => {
    expect(crudDisabledReason(null)).toBeTruthy();
    expect(crudDisabledReason({ id: "c1", type: "form", label: "F", pos: "a0" })).toBeTruthy();
  });

  it("allows a list with at least one data column", () => {
    expect(crudDisabledReason(list([col("e1", "Name")]))).toBeNull();
  });
});
