// A full-size look at the screenshots on a report: the thumbnails on the
// feedback form are too small to read a page from.
//
// Drawn into a <canvas> from the bitmap the field already holds, for the same
// reason the thumbnails are (see Thumb in ScreenshotField): the CSP refuses
// blob: images, and the presigned download URL is cross-origin.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ScreenshotItem } from "./ScreenshotField";

/**
 * Where the arrows go from `index` in a list of `count`. Wraps at both ends,
 * so a reporter flicking through a handful of shots never hits a dead key.
 */
export function stepIndex(index: number, delta: number, count: number): number {
  if (count <= 0) return 0;
  return (((index + delta) % count) + count) % count;
}

export function ScreenshotViewer({
  items,
  start,
  onClose,
}: {
  items: ScreenshotItem[];
  start: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(start);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const item = items[Math.min(index, items.length - 1)];
  const many = items.length > 1;

  // Close if the list empties under us (the report was switched or the shot removed).
  useEffect(() => {
    if (!item) onClose();
  }, [item, onClose]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !item) return;
    canvas.width = item.bitmap.width;
    canvas.height = item.bitmap.height;
    canvas.getContext("2d")?.drawImage(item.bitmap, 0, 0);
  }, [item]);

  // Window, capture phase: the Drawer underneath closes on a document-level
  // Escape, and this has to get the key first or Escape would shut both.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      let handled = true;
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" && many) setIndex((i) => stepIndex(i, 1, items.length));
      else if (e.key === "ArrowLeft" && many) setIndex((i) => stepIndex(i, -1, items.length));
      else handled = false;
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [many, items.length, onClose]);

  if (!item) return null;

  const download = () => {
    const url = URL.createObjectURL(item.file);
    const a = document.createElement("a");
    a.href = url;
    a.download = item.file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  // Portalled for the reason the editor is: the field sits inside the drawer's
  // <form>, and every button in here would otherwise be a submit button.
  return createPortal(
    <div
      className="shot-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={`Screenshot ${index + 1} of ${items.length}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="shot-viewer-bar">
        <span className="shot-viewer-name" title={item.file.name}>
          {item.file.name}
        </span>
        <span className="shot-meta">
          {many && `${index + 1} / ${items.length} · `}
          {item.bitmap.width} × {item.bitmap.height}
        </span>
        <span className="shell-spacer" />
        <button type="button" className="btn small ghost" onClick={download}>
          Download
        </button>
        <button type="button" className="btn small ghost" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      <div
        className="shot-viewer-stage"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        {many && (
          <button
            type="button"
            className="shot-viewer-nav prev"
            aria-label="Previous screenshot"
            onClick={() => setIndex((i) => stepIndex(i, -1, items.length))}
          >
            ‹
          </button>
        )}
        <canvas ref={canvasRef} />
        {many && (
          <button
            type="button"
            className="shot-viewer-nav next"
            aria-label="Next screenshot"
            onClick={() => setIndex((i) => stepIndex(i, 1, items.length))}
          >
            ›
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
