import { describe, expect, it } from "vitest";
import { matchScore, singular, suggestDataset } from "./datasetMatch";

describe("singular", () => {
  it("undoes the regular English plurals", () => {
    expect(["industries", "countries", "statuses", "addresses", "boxes", "titles", "people", "status"].map(singular)).toEqual([
      "industry", "country", "status", "address", "box", "title", "person", "status",
    ]);
  });
});

describe("matchScore", () => {
  it("ranks the same words over a shared head noun over mere containment", () => {
    expect(matchScore("Industry", "Industries")).toBe(3);
    expect(matchScore("City", "UK cities")).toBe(2);
    expect(matchScore("Email", "Email addresses")).toBe(1);
    expect(matchScore("Industry", "Countries")).toBe(0);
  });
});

describe("suggestDataset", () => {
  const sets = [
    { id: "a", name: "Order statuses", scope: "platform" },
    { id: "b", name: "Record status", scope: "platform" },
    { id: "c", name: "Countries", scope: "platform" },
    { id: "d", name: "Countries", scope: "project" },
  ];
  it("prefers the project's own list at the same fit", () => {
    expect(suggestDataset("Country", sets)?.id).toBe("d");
  });
  it("makes no guess when the best fit is shared", () => {
    expect(suggestDataset("Status", sets)).toBeNull();
  });
  it("makes no guess for a label nothing names", () => {
    expect(suggestDataset("Choice", sets)).toBeNull();
  });
});
