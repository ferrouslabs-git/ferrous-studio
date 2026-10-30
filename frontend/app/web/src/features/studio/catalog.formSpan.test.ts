import { describe, expect, it } from "vitest";
import { formSpan, isFormFieldType, isMultiPick } from "./catalog";

const field = (type: string, span?: string) => (span ? { type, data: { span } } : { type });

describe("form field widths (FS-REQ-74)", () => {
  it("an unset width follows the layout", () => {
    expect(formSpan(field("text-input"), "one-column")).toBe(12);
    expect(formSpan(field("text-input"), "horizontal")).toBe(12);
    expect(formSpan(field("text-input"), "two-column")).toBe(6);
  });

  it("wide fields and headings take the whole row unless told otherwise", () => {
    expect(formSpan(field("text-area"), "two-column")).toBe(12);
    expect(formSpan(field("section-heading"), "two-column")).toBe(12);
    expect(formSpan(field("text-area", "half"), "two-column")).toBe(6);
  });

  it("a set width wins over the layout, in twelfths", () => {
    expect(formSpan(field("select", "third"), "one-column")).toBe(4);
    expect(formSpan(field("select", "quarter"), "two-column")).toBe(3);
    expect(formSpan(field("select", "two-thirds"), "two-column")).toBe(8);
    expect(formSpan(field("select", "full"), "two-column")).toBe(12);
  });

  it("an unknown width is ignored", () => {
    expect(formSpan(field("select", "fifth"), "two-column")).toBe(6);
  });

  it("only grid fields take a width", () => {
    expect(isFormFieldType("text-input")).toBe(true);
    expect(isFormFieldType("help-text")).toBe(true);
    expect(isFormFieldType("button")).toBe(false);
    expect(isFormFieldType("step")).toBe(false);
    expect(isFormFieldType("header")).toBe(false);
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
