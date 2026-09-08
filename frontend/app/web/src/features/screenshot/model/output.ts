// How big a screenshot is kept, and how it is encoded.
//
// Pure decisions only -- the actual encoding lives in render.ts, which needs a
// canvas. Everything here takes numbers, so it is unit-tested in node.
import { ImageSize } from "./shapes";

/**
 * The longest edge a capture is reduced to, ONCE, at capture time.
 *
 * Doing it here rather than at save is the move that keeps the rest simple:
 * afterwards "natural image pixels" means one thing everywhere -- the bitmap,
 * the SVG viewBox, every stored point and the output all agree, and flatten()
 * is a straight 1:1 draw with no third scale to reconcile.
 *
 * 2560 and not 1920: a HiDPI capture of a 1280-CSS-px tab *is* 2560 native, and
 * squeezing that to 1920 blurs text which is currently pixel-perfect -- the
 * text a bug report usually exists to show. A true 4K tab still halves in area.
 */
export const OUTPUT_MAX_EDGE = 2560;

/** Comfortably under the 25 MB server cap, and small enough to attach on a
 *  hotel wifi. Exceeding it costs quality, not the upload. */
export const TARGET_BYTES = 1_500_000;

export interface Encoding {
  type: "image/png" | "image/jpeg";
  quality: number;
  /** Longest edge to draw at; OUTPUT_MAX_EDGE unless the ladder gives up. */
  maxEdge: number;
}

/** Multiplier that brings the longest edge down to `maxEdge`. Never enlarges. */
export function captureScale(width: number, height: number, maxEdge: number): number {
  const longest = Math.max(width, height);
  if (longest === 0) return 1;
  return Math.min(1, maxEdge / longest);
}

/** Apply captureScale, rounding to whole pixels and never to zero. */
export function scaledSize(image: ImageSize, maxEdge: number): ImageSize {
  const scale = captureScale(image.width, image.height, maxEdge);
  return {
    width: Math.max(1, Math.round(image.width * scale)),
    height: Math.max(1, Math.round(image.height * scale)),
  };
}

/**
 * Encodings to try in order, stopping at the first that fits the budget.
 *
 * PNG first because a screenshot is flat UI colour and crisp text, which PNG
 * compresses well and JPEG puts ringing artefacts around -- on exactly the text
 * the report is about. JPEG is the relief valve for the minority of captures
 * (photographs, heavy gradients, huge pages) where PNG runs away, and the last
 * rung halves the resolution rather than failing to produce anything at all.
 */
export function encodingLadder(image: ImageSize): Encoding[] {
  return [
    { type: "image/png", quality: 1, maxEdge: OUTPUT_MAX_EDGE },
    { type: "image/jpeg", quality: 0.9, maxEdge: OUTPUT_MAX_EDGE },
    { type: "image/jpeg", quality: 0.75, maxEdge: OUTPUT_MAX_EDGE },
    {
      type: "image/jpeg",
      quality: 0.8,
      maxEdge: Math.max(640, Math.round(Math.max(image.width, image.height) / 2)),
    },
  ];
}

/** "780 KB", "1.4 MB" -- the toolbar readout. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The extension for an encoding, for the filename the upload is given. */
export function extensionFor(type: Encoding["type"]): string {
  return type === "image/png" ? "png" : "jpg";
}
