import { describe, expect, it } from "vitest";
import { normaliseDatasetValues, parseDatasetValues } from "./datasetValues";

describe("parseDatasetValues (FS-REQ-63)", () => {
  it("takes one value per line", () => {
    expect(parseDatasetValues("Red\nGreen\r\n\n Blue ")).toEqual(["Red", "Green", "Blue"]);
  });

  it("splits a single comma-separated line into separate values", () => {
    expect(parseDatasetValues("1 Mar 2026, 8 Mar 2026,15 Mar 2026")).toEqual(["1 Mar 2026", "8 Mar 2026", "15 Mar 2026"]);
  });

  it("keeps commas inside values when there are several lines", () => {
    expect(parseDatasetValues("12 High Street, Leeds\n8 Queen's Road, Bristol")).toEqual([
      "12 High Street, Leeds",
      "8 Queen's Road, Bristol",
    ]);
  });

  it("returns nothing for blank text", () => {
    expect(parseDatasetValues("  \n ")).toEqual([]);
  });
});

describe("normaliseDatasetValues", () => {
  it("splits a dataset stored as one comma-joined value", () => {
    expect(normaliseDatasetValues(["Mon, Tue, Wed"])).toEqual(["Mon", "Tue", "Wed"]);
  });

  it("leaves real lists alone", () => {
    expect(normaliseDatasetValues(["12 High Street, Leeds", "3 Castle Street, Edinburgh"])).toEqual([
      "12 High Street, Leeds",
      "3 Castle Street, Edinburgh",
    ]);
    expect(normaliseDatasetValues(["Only"])).toEqual(["Only"]);
    expect(normaliseDatasetValues([])).toEqual([]);
  });
});
