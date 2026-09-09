// Fails the moment catalog.ts changes without a re-run of `npm run
// catalog:emit`: the backend's bundle validator trusts catalog.json to be
// exactly what the canvas editor allows, and this is the only thing
// standing between that trust and the two silently drifting apart.
import { describe, expect, it } from "vitest";
import catalogJson from "../../../../../../backend/app/studio/catalog.json";
import { buildCatalogMirror } from "./catalogMirror";

describe("catalog.json mirrors catalog.ts", () => {
  it("is exactly what buildCatalogMirror() derives right now", () => {
    expect(catalogJson).toEqual(buildCatalogMirror());
  });
});
