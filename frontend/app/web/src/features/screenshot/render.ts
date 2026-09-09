// Painting shapes onto a canvas, and flattening a screenshot plus its
// annotations into one image.
//
// This is the second of the editor's two renderers. The first is the SVG in
// ScreenshotEditor.tsx, which is what you see while drawing; this one is what
// actually gets saved. They must agree, so both consume the same helpers from
// model/shapes.ts (normRect, arrowHead, pathD's point list), both switch
// exhaustively over the same union, and both walk the array in STRICT LIST
// ORDER -- paint order is document order, so a redaction bar drawn over an
// arrow covers it in the preview and in the file alike.
//
// Not unit tested: it needs a real canvas. The geometry it leans on is.
import { Encoding } from "./model/output";
import {
  arrowHead,
  ImageSize,
  normRect,
  Shape,
  strokeScale,
} from "./model/shapes";

/** A dark halo under every mark. Without it a white annotation vanishes on a
 *  white screenshot and a black one vanishes on a dark UI -- this is the single
 *  detail that makes annotation legible against an arbitrary background. */
const HALO = "rgba(0,0,0,0.55)";

export function drawShape(ctx: CanvasRenderingContext2D, shape: Shape, image: ImageSize): void {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  switch (shape.kind) {
    case "arrow": {
      const head = arrowHead(shape.from, shape.to, shape.width);
      // The shaft stops short of the tip so the head's point is the extreme.
      strokeWithHalo(ctx, shape.width, shape.colour, () => {
        ctx.beginPath();
        ctx.moveTo(shape.from.x, shape.from.y);
        ctx.lineTo(shape.to.x, shape.to.y);
        ctx.stroke();
      });
      fillWithHalo(ctx, shape.width, shape.colour, () => {
        ctx.beginPath();
        ctx.moveTo(head[0].x, head[0].y);
        ctx.lineTo(head[1].x, head[1].y);
        ctx.lineTo(head[2].x, head[2].y);
        ctx.closePath();
        ctx.fill();
      });
      break;
    }

    case "rect": {
      const r = normRect(shape.a, shape.b);
      strokeWithHalo(ctx, shape.width, shape.colour, () => {
        ctx.beginPath();
        ctx.rect(r.x, r.y, r.width, r.height);
        ctx.stroke();
      });
      break;
    }

    case "freehand": {
      if (shape.points.length > 0) {
        strokeWithHalo(ctx, shape.width, shape.colour, () => {
          ctx.beginPath();
          ctx.moveTo(shape.points[0].x, shape.points[0].y);
          for (const p of shape.points.slice(1)) ctx.lineTo(p.x, p.y);
          // A single tap is a dot, not nothing.
          if (shape.points.length === 1) ctx.lineTo(shape.points[0].x + 0.01, shape.points[0].y);
          ctx.stroke();
        });
      }
      break;
    }

    case "text": {
      if (shape.text !== "") {
        // Must match .shot-text in screenshot.css, or saved text jumps.
        ctx.font = `600 ${shape.size}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
        ctx.textBaseline = "alphabetic";
        ctx.lineWidth = Math.max(2, shape.size * 0.16);
        ctx.strokeStyle = HALO;
        ctx.lineJoin = "round";
        ctx.strokeText(shape.text, shape.at.x, shape.at.y);
        ctx.fillStyle = shape.colour;
        ctx.fillText(shape.text, shape.at.x, shape.at.y);
      }
      break;
    }

    case "redact": {
      // Opaque, and burned in: see the invariant in ScreenshotEditor.tsx. No
      // halo -- a bar is meant to be a hole in the picture, not a mark on it.
      const r = normRect(shape.a, shape.b);
      ctx.fillStyle = "#000000";
      ctx.fillRect(r.x, r.y, r.width, r.height);
      break;
    }
  }

  ctx.restore();
  void image;
}

function strokeWithHalo(
  ctx: CanvasRenderingContext2D,
  width: number,
  colour: string,
  path: () => void,
): void {
  ctx.strokeStyle = HALO;
  ctx.lineWidth = width * 2.1;
  path();
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  path();
}

function fillWithHalo(
  ctx: CanvasRenderingContext2D,
  width: number,
  colour: string,
  path: () => void,
): void {
  ctx.strokeStyle = HALO;
  ctx.lineWidth = width * 1.6;
  ctx.fillStyle = HALO;
  path();
  ctx.stroke();
  ctx.fillStyle = colour;
  path();
}

/** Paint the screenshot itself into a canvas sized to it. Idempotent, because
 *  React StrictMode double-invokes the effect that calls it. */
export function paintBackground(canvas: HTMLCanvasElement, bitmap: ImageBitmap): void {
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0);
}

/**
 * The screenshot with its annotations burned in, as one image.
 *
 * The canvas is never tainted: a getDisplayMedia frame is user-granted and
 * origin-clean, and createImageBitmap(File) likewise, so toBlob() succeeds.
 * (It would not, had the source been a cross-origin <img> without CORS -- which
 * is one reason saved screenshots are served from our own origin.)
 */
export async function flatten(
  bitmap: ImageBitmap,
  shapes: readonly Shape[],
  enc: Encoding,
): Promise<Blob> {
  const scale = Math.min(1, enc.maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not prepare the image for saving.");

  // One scale for the whole draw, so shape coordinates -- which are in natural
  // image pixels -- go in untouched.
  ctx.scale(scale, scale);
  ctx.drawImage(bitmap, 0, 0);

  const image = { width: bitmap.width, height: bitmap.height };
  for (const shape of shapes) drawShape(ctx, shape, image);

  return await toBlob(canvas, enc);
}

function toBlob(canvas: HTMLCanvasElement, enc: Encoding): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not encode the image."))),
      enc.type,
      enc.quality,
    );
  });
}

/** Used by the editor to size marks it draws itself (the selection outline). */
export const outlineWidth = (image: ImageSize): number => 1.5 * strokeScale(image);
