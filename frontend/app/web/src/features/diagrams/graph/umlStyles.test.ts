// The theme flip works through live module bindings that the style factories
// read at call time. That is easy to break by turning a factory back into a
// const, so pin the behaviour down here.
import { afterEach, describe, expect, it } from "vitest";
import { applyUmlTheme, edgeStyleFor, vertexStyleFor } from "./umlStyles";

afterEach(() => applyUmlTheme("dark"));

describe("applyUmlTheme", () => {
  it("inverts ink and paper between the themes", () => {
    applyUmlTheme("dark");
    const dark = vertexStyleFor("class");
    applyUmlTheme("light");
    const light = vertexStyleFor("class");

    expect(dark.fillColor).toBe("#1A1A23");
    expect(dark.fontColor).toBe("#F4F4F7");
    expect(light.fillColor).toBe("#FFFFFF");
    expect(light.fontColor).toBe("#16161C");
  });

  it("restyles solid-ink nodes, whose fill is the ink itself", () => {
    applyUmlTheme("light");
    expect(vertexStyleFor("start").fillColor).toBe("#16161C");
  });

  it("follows the theme for the edge label backdrop, which sits on the canvas", () => {
    applyUmlTheme("dark");
    expect(edgeStyleFor("association").labelBackgroundColor).toBe("#0B0B11");
    applyUmlTheme("light");
    expect(edgeStyleFor("association").labelBackgroundColor).toBe("#F4F3F1");
  });

  it("keeps the note and the brand accent fixed in both themes", () => {
    applyUmlTheme("dark");
    const dark = vertexStyleFor("note");
    applyUmlTheme("light");
    expect(vertexStyleFor("note")).toEqual(dark);
  });
});
