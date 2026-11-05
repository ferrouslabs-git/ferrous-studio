// SVG uploads stay vector (FS-REQ-86), but only when they are static.
import { describe, expect, it } from "vitest";
import { hasTransparency, isStaticSvg, isSvgFile, svgDataUrl, withSvgNamespace } from "./imageFile";

describe("SVG uploads", () => {
  it("recognises an SVG by type or by extension", () => {
    expect(isSvgFile({ type: "image/svg+xml", name: "logo" })).toBe(true);
    expect(isSvgFile({ type: "", name: "Logo.SVG" })).toBe(true);
    expect(isSvgFile({ type: "image/png", name: "logo.png" })).toBe(false);
  });

  it("keeps a plain drawing as markup", () => {
    expect(isStaticSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10"/></svg>')).toBe(true);
  });

  it("refuses anything active", () => {
    for (const bad of [
      "<svg><script>alert(1)</script></svg>",
      '<svg onload="alert(1)"></svg>',
      '<svg><a href="javascript:alert(1)"><rect/></a></svg>',
      "<svg><foreignObject><div/></foreignObject></svg>",
      '<!DOCTYPE svg [<!ENTITY x "y">]><svg></svg>',
      "<html><body>not an svg</body></html>",
    ]) {
      expect(isStaticSvg(bad)).toBe(false);
    }
  });

  it("encodes UTF-8 text as a base64 SVG data URL", () => {
    const url = svgDataUrl("<svg><text>£</text></svg>");
    expect(url.startsWith("data:image/svg+xml;base64,")).toBe(true);
    const bytes = Uint8Array.from(atob(url.split(",")[1]), (c) => c.charCodeAt(0));
    expect(new TextDecoder().decode(bytes)).toBe('<svg xmlns="http://www.w3.org/2000/svg"><text>£</text></svg>');
  });

  it("adds the SVG namespace an image needs, once", () => {
    expect(withSvgNamespace('<svg viewBox="0 0 1 1"><svg/></svg>')).toBe('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><svg/></svg>');
    const ok = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
    expect(withSvgNamespace(ok)).toBe(ok);
  });
});

describe("hasTransparency", () => {
  const ctxOf = (alphas: number[]) => ({
    getImageData: () => ({ data: alphas.flatMap((a) => [10, 20, 30, a]) }),
  });
  it("spots any see-through pixel, so the upload stays PNG", () => {
    expect(hasTransparency(ctxOf([255, 255, 0]), 3, 1)).toBe(true);
    expect(hasTransparency(ctxOf([255, 128]), 2, 1)).toBe(true);
  });
  it("is false for a fully opaque picture, which can go JPEG", () => {
    expect(hasTransparency(ctxOf([255, 255, 255]), 3, 1)).toBe(false);
  });
});
