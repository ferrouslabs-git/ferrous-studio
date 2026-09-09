// The screenshot control on the feedback form: the three ways to get an image
// in, the editor that opens on each, and the thumbnails of what is attached.
//
// The editor is lazy so that neither it nor its CSS is in the main bundle --
// most people opening the feedback form never annotate anything.
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { canCaptureScreen, Captured, CaptureError, captureScreen, fromClipboardEvent, fromFile } from "./capture";
import "./screenshot.css";

const ScreenshotEditor = lazy(() =>
  import("./ScreenshotEditor").then((m) => ({ default: m.ScreenshotEditor })),
);

export interface ScreenshotItem {
  id: string;
  file: File;
  /** Drawn into a thumbnail canvas; owned here and closed on removal. */
  bitmap: ImageBitmap;
  status: "queued" | "uploading" | "done" | "failed";
  error?: string;
}

export function ScreenshotField({
  items,
  disabled,
  onAdd,
  onRemove,
}: {
  items: ScreenshotItem[];
  disabled?: boolean;
  onAdd: (file: File, bitmap: ImageBitmap) => void;
  onRemove: (id: string) => void;
}) {
  const [capture, setCapture] = useState<Captured | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const canCapture = canCaptureScreen();

  const run = async (work: () => Promise<Captured | null>) => {
    setError(null);
    try {
      const shot = await work();
      if (shot) setCapture(shot);
    } catch (err) {
      setError(err instanceof CaptureError ? err.message : "Could not read that image.");
    }
  };

  // Paste anywhere in the form. The best route on Firefox and Safari, and on
  // Windows (Win+Shift+S) and macOS (Cmd+Ctrl+Shift+4) the fastest anywhere.
  useEffect(() => {
    if (disabled) return;
    const onPaste = (e: ClipboardEvent) => {
      if (capture) return; // the editor is open; let it have the paste
      void run(async () => {
        const shot = await fromClipboardEvent(e);
        if (shot) e.preventDefault();
        return shot;
      });
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled, capture]);

  const onDrop = (e: React.DragEvent) => {
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    e.preventDefault();
    void run(() => fromFile(file));
  };

  return (
    <div
      className="shot-field"
      onDrop={disabled ? undefined : onDrop}
      onDragOver={disabled ? undefined : (e) => e.preventDefault()}
    >
      {!disabled && (
        <div className="shot-sources">
          {canCapture && (
            <button
              type="button"
              className="btn small ghost"
              // No await before captureScreen -- getDisplayMedia needs the
              // click's transient activation, and Safari enforces it strictly.
              onClick={() => void run(() => captureScreen())}
            >
              Capture a tab
            </button>
          )}
          <button type="button" className="btn small ghost" onClick={() => fileRef.current?.click()}>
            Choose an image
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = ""; // so the same file can be picked twice
              if (file) void run(() => fromFile(file));
            }}
          />
        </div>
      )}

      {!disabled && (
        <span className="shot-note">
          {canCapture
            ? "Captures what is on screen, so scroll to the problem in the other tab first. You can also paste or drop an image."
            : "Paste or drop an image, or choose one."}
        </span>
      )}

      {error && <div className="status-banner warn">{error}</div>}

      {items.length > 0 && (
        <div className="shot-thumbs">
          {items.map((item) => (
            <Thumb key={item.id} item={item} onRemove={disabled ? undefined : () => onRemove(item.id)} />
          ))}
        </div>
      )}

      {/* Portalled to the body rather than rendered here. This field lives
          inside the feedback drawer's <form>, and a whole editor nested in
          someone else's form inherits its semantics -- every button becomes a
          submit button unless it says otherwise, and a click inside the editor
          reaches the form's own controls. The editor is a dialog in its own
          right, so it belongs at the top level. */}
      {capture &&
        createPortal(
          <Suspense fallback={null}>
            <ScreenshotEditor
              capture={capture}
              onCancel={() => {
                capture.bitmap.close();
                setCapture(null);
              }}
              onSave={async (file) => {
                // The bitmap is handed on for the thumbnail rather than closed
                // -- the caller owns it from here.
                onAdd(file, capture.bitmap);
                setCapture(null);
              }}
            />
          </Suspense>,
          document.body,
        )}
    </div>
  );
}

/**
 * A thumbnail drawn from the bitmap we already hold.
 *
 * A <canvas> rather than an <img src={URL.createObjectURL(...)}>: the app's CSP
 * allows `img-src 'self' data:` and no blob:, so an object URL would be blocked
 * outright in staging and production. Drawing costs nothing here -- the bitmap
 * is in hand -- and it sidesteps the revoke-on-unmount lifecycle entirely.
 */
function Thumb({ item, onRemove }: { item: ScreenshotItem; onRemove?: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const scale = Math.max(92 / item.bitmap.width, 62 / item.bitmap.height);
    canvas.width = Math.max(1, Math.round(item.bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(item.bitmap.height * scale));
    canvas.getContext("2d")?.drawImage(item.bitmap, 0, 0, canvas.width, canvas.height);
  }, [item.bitmap]);

  const busy = item.status === "uploading";
  return (
    <div
      className={`shot-thumb${busy ? " is-busy" : ""}${item.status === "failed" ? " is-failed" : ""}`}
      title={item.error ?? item.file.name}
    >
      <canvas ref={ref} />
      {onRemove && item.status !== "uploading" && item.status !== "done" && (
        <button type="button" className="shot-thumb-drop" aria-label={`Remove ${item.file.name}`} onClick={onRemove}>
          ×
        </button>
      )}
      {item.status !== "queued" && <span className="shot-thumb-state">{item.status}</span>}
    </div>
  );
}
