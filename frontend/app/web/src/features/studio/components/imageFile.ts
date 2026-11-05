// Reading an uploaded picture into the inline data URL a wireframe stores
// (image elements, logos, nav icons, image columns).
//
// Raster files are downscaled through a canvas. SVG used to go the same way,
// which is why SVGs never showed (FS-REQ-86): an SVG with only a viewBox has
// no natural size, so the canvas came out 1×1, and larger pictures were saved
// as JPEG, which paints an SVG's transparent background black. An SVG is now
// kept as itself — a `data:image/svg+xml` URL, which the studio only ever
// draws through <img>, where an SVG is a static picture: no script runs and
// nothing outside the file loads. As a second fence, an SVG carrying anything
// active (script, event handlers, embedded HTML) or too large to inline is
// rasterised to PNG instead of being stored as markup.

/** Larger SVGs are rasterised rather than stored as text in the document. */
export const SVG_INLINE_MAX_BYTES = 256 * 1024;

/** Fallback edge for an SVG that declares no size (only a viewBox). */
const SVG_FALLBACK_PX = 512;

export const isSvgFile = (file: { type: string; name: string }): boolean =>
  file.type === "image/svg+xml" || /\.svg$/i.test(file.name);

/** Markup that could do anything beyond drawing, were the SVG ever opened
 *  as a document rather than an image. */
const ACTIVE_SVG = /<\s*script|<\s*foreignObject|<\s*iframe|<\s*embed|<\s*object|\son[a-z]+\s*=|javascript:|<!ENTITY/i;

/** True when `text` is a plain, static SVG that is safe to keep as markup. */
export function isStaticSvg(text: string): boolean {
  return /<svg[\s>]/i.test(text) && !ACTIVE_SVG.test(text);
}

/** An SVG whose root tag has no xmlns is valid inline in HTML, but as an
 *  image it fails to decode at all; hand-written and exported files often
 *  omit it, so add it. */
export function withSvgNamespace(text: string): string {
  return text.replace(/<svg(\s[^>]*)?>/i, (tag, attrs: string = "") =>
    /\sxmlns\s*=/.test(attrs) ? tag : `<svg xmlns="http://www.w3.org/2000/svg"${attrs}>`,
  );
}

/** `text` as a base64 `data:image/svg+xml` URL (UTF-8 safe). */
export function svgDataUrl(text: string): string {
  const bytes = new TextEncoder().encode(withSvgNamespace(text));
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/svg+xml;base64,${btoa(bin)}`;
}

/** Draw an image URL into a canvas at most `maxPx` on its long edge. */
function rasterise(url: string, maxPx: number, type: "image/png" | "image/jpeg", cb: (dataUrl: string) => void): void {
  const img = new Image();
  img.onload = () => {
    const w0 = img.naturalWidth || SVG_FALLBACK_PX;
    const h0 = img.naturalHeight || w0;
    const scale = Math.min(1, maxPx / Math.max(w0, h0));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w0 * scale));
    canvas.height = Math.max(1, Math.round(h0 * scale));
    canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    cb(canvas.toDataURL(type, 0.85));
  };
  img.onerror = () => URL.revokeObjectURL(url);
  img.src = url;
}

/** Read an image file and hand back a data URL for inline storage. Raster
 *  images are downscaled to at most `maxPx` (small marks stay PNG for
 *  transparency; larger pictures become JPEG); SVGs stay vector (see the
 *  module note). */
export function readImageFile(file: File, maxPx: number, cb: (dataUrl: string) => void, mark = maxPx <= 128): void {
  if (!isSvgFile(file)) {
    rasterise(URL.createObjectURL(file), maxPx, mark ? "image/png" : "image/jpeg", cb);
    return;
  }
  void file.text().then((text) => {
    if (file.size <= SVG_INLINE_MAX_BYTES && isStaticSvg(text)) {
      cb(svgDataUrl(text));
      return;
    }
    // Typed explicitly: a file the OS reports with no MIME type would not
    // decode as SVG from an untyped object URL.
    const url = URL.createObjectURL(new Blob([withSvgNamespace(text)], { type: "image/svg+xml" }));
    rasterise(url, maxPx, "image/png", cb);
  });
}
