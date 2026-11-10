import { describe, expect, it } from "vitest";
import { formColumns, formRows, formSpan, isFormFieldType, isMultiPick } from "./catalog";

const field = (type: string, data?: Record<string, string>) => (data ? { type, data } : { type });

describe("form field widths (FS-REQ-74)", () => {
  it("an unset width is one column's share of its row", () => {
    expect(formSpan(field("text-input"), 1)).toBe(12);
    expect(formSpan(field("text-input"), 2)).toBe(6);
    expect(formSpan(field("text-input"), 3)).toBe(4);
    expect(formSpan(field("text-input"), 4)).toBe(3);
  });

  it("wide fields and headings take the whole row unless told otherwise", () => {
    expect(formSpan(field("text-area"), 2)).toBe(12);
    expect(formSpan(field("section-heading"), 3)).toBe(12);
    expect(formSpan(field("text-area", { span: "half" }), 2)).toBe(6);
  });

  it("a set width wins over the column count, in twelfths", () => {
    expect(formSpan(field("select", { span: "third" }), 1)).toBe(4);
    expect(formSpan(field("select", { span: "quarter" }), 2)).toBe(3);
    expect(formSpan(field("select", { span: "full" }), 4)).toBe(12);
  });

  it("an unknown width is ignored", () => {
    expect(formSpan(field("select", { span: "fifth" }), 2)).toBe(6);
  });

  it("only grid fields take a width", () => {
    expect(isFormFieldType("text-input")).toBe(true);
    expect(isFormFieldType("help-text")).toBe(true);
    expect(isFormFieldType("button")).toBe(false);
    expect(isFormFieldType("step")).toBe(false);
    expect(isFormFieldType("header")).toBe(false);
  });
});

describe("form columns and rows", () => {
  it("reads props.columns, else the retired two-column layout", () => {
    expect(formColumns({ props: { columns: "3" } })).toBe(3);
    expect(formColumns({ layout: "two-column" })).toBe(2);
    expect(formColumns({ layout: "two-column", props: { columns: "4" } })).toBe(4);
    expect(formColumns({ props: { columns: "5" } })).toBe(1);
  });

  it("wraps fields into rows of the form's count", () => {
    const cells = formRows([field("text-input"), field("text-input"), field("text-input")], 2);
    expect(cells.map((c) => [c.row, c.span])).toEqual([[0, 6], [0, 6], [1, 6]]);
  });

  it("a row's own count holds for that row, then the form's returns", () => {
    const cells = formRows(
      [
        field("text-input"),
        field("text-input", { rowCols: "3" }),
        field("text-input"),
        field("text-input"),
        field("text-input"),
      ],
      2,
    );
    expect(cells.map((c) => [c.row, c.span, c.rowStart])).toEqual([
      [0, 6, true],
      [1, 4, true],
      [1, 4, false],
      [1, 4, false],
      [2, 6, true],
    ]);
  });

  it("field widths mix inside a counted row", () => {
    const cells = formRows([field("text-input", { rowCols: "4" }), field("select", { span: "half" }), field("select")], 1);
    expect(cells.map((c) => [c.row, c.span])).toEqual([[0, 3], [0, 6], [0, 3]]);
  });
});

describe("multi-pick types (FS-REQ-76)", () => {
  it("covers the multi-select filters and the form's multi-select dropdown", () => {
    expect(isMultiPick("multi-select")).toBe(true);
    expect(isMultiPick("filter-multi")).toBe(true);
    expect(isMultiPick("filter-multi-search")).toBe(true);
    expect(isMultiPick("select")).toBe(false);
  });
});
