// Annotating a captured screenshot.
//
// ARCHITECTURE. A <canvas> holds the screenshot, painted once; an <svg> of
// shape elements sits over it, absolutely positioned and sharing its box. The
// SVG carries viewBox="0 0 W H", so the browser does every scale conversion and
// no shape has to know how large the image is drawn -- and each shape is a DOM
// node, so selecting one is a handler on the element rather than hand-written
// hit-testing in a paint loop. Only at save time is the whole thing rasterised
// by render.ts's flatten().
//
// The cost is two renderers that must agree: the switch below and the switch in
// render.ts. They consume the same helpers from model/shapes.ts, they are both
// exhaustive over the same union, and they both walk the array in list order.
// Change one and you must change the other.
//
// REDACTION INVARIANT. A redaction is a hole in the picture, not a sticker on
// it. The shape array lives in this component's state, is never serialised and
// never leaves; the only thing that leaves is flatten()'s Blob, with the bars
// burned into the pixels. If re-editable annotations are ever wanted, the
// redactions must be burned into the stored base image BEFORE any shape list is
// persisted -- a saved shape list containing a `redact` entry is a data leak.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Drawer } from "../../components/Drawer";
import { Captured } from "./capture";
import { Encoding, encodingLadder, extensionFor, formatSize, TARGET_BYTES } from "./model/output";
import { ShapeHistory } from "./model/history";
import {
  arrowHead,
  boundsOf,
  DEFAULT_COLOUR,
  fontSize,
  ImageSize,
  newShape,
  normRect,
  PALETTE,
  pathD,
  Point,
  Shape,
  ShapeKind,
  simplify,
  strokeWidth,
  Style,
  toImagePoint,
  translateShape,
  hitTest,
  extendDraft,
} from "./model/shapes";
import { flatten, outlineWidth, paintBackground } from "./render";
import "./screenshot.css";

type Tool = "select" | ShapeKind;

const TOOLS: { tool: Tool; label: string; key: string }[] = [
  { tool: "select", label: "Select", key: "V" },
  { tool: "arrow", label: "Arrow", key: "A" },
  { tool: "rect", label: "Box", key: "R" },
  { tool: "freehand", label: "Draw", key: "D" },
  { tool: "text", label: "Text", key: "T" },
  { tool: "redact", label: "Redact", key: "X" },
];

/** How close a click must be, in image pixels, to count as hitting a mark. */
const HIT_TOLERANCE = 6;

export function ScreenshotEditor({
  capture,
  onCancel,
  onSave,
}: {
  capture: Captured;
  onCancel: () => void;
  /** Handed the finished file. Named here, not by the canvas, because a Blob
   *  has no name and the server's allow-list keys on the extension. */
  onSave: (file: File) => Promise<void> | void;
}) {
  const image: ImageSize = { width: capture.width, height: capture.height };

  const historyRef = useRef<ShapeHistory>(new ShapeHistory());
  const [, bump] = useState(0);
  const shapes = historyRef.current.shapes;
  const commit = useCallback((next: Shape[]) => {
    historyRef.current.push(next);
    bump((n) => n + 1);
  }, []);

  const [tool, setTool] = useState<Tool>("arrow");
  const [style, setStyle] = useState<Style>({ colour: DEFAULT_COLOUR, step: 1 });
  const [draft, setDraft] = useState<Shape | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [editingText, setEditingText] = useState<{ id: string; value: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<{ bytes: number; type: Encoding["type"] } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Paint the screenshot once. Idempotent, because StrictMode runs this twice
  // in development; the bitmap is owned by the caller and closed by it.
  useEffect(() => {
    if (canvasRef.current) paintBackground(canvasRef.current, capture.bitmap);
  }, [capture.bitmap]);

  const visible = useMemo(() => (draft ? [...shapes, draft] : [...shapes]), [shapes, draft]);

  // ── Pointer drawing ────────────────────────────────────────────────────
  // The window-listener pattern the studio canvas uses: capture on pointerdown,
  // follow on the window so a drag that leaves the element still tracks, and
  // convert through the live rect so any zoom works without being told.

  const pointAt = useCallback(
    (e: { clientX: number; clientY: number }): Point => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return toImagePoint(e.clientX, e.clientY, rect, image);
    },
    [image],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || editingText) return;
    const at = pointAt(e);

    if (tool === "select") {
      const hit = hitTest(shapes, at, HIT_TOLERANCE);
      setSelected(hit);
      if (hit) startMove(hit, at);
      return;
    }

    if (tool === "text") {
      const shape = newShape("text", at, style, image);
      commit([...shapes, shape]);
      setSelected(shape.id);
      setEditingText({ id: shape.id, value: "" });
      setTool("select");
      return;
    }

    setSelected(null);
    const shape = newShape(tool, at, style, image);
    setDraft(shape);
    startDraw(shape, at);
  };

  /** Grow a new shape until the pointer is released. One history entry. */
  const startDraw = (shape: Shape, _from: Point) => {
    let current = shape;
    const move = (ev: PointerEvent) => {
      current = extendDraft(current, pointAt(ev));
      setDraft(current);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDraft(null);
      const finished =
        current.kind === "freehand"
          ? { ...current, points: simplify(current.points, Math.max(1, strokeWidth(image, style.step) * 0.4)) }
          : current;
      if (isDegenerate(finished)) return; // a stray click leaves nothing behind
      commit([...historyRef.current.shapes, finished]);
      setSelected(finished.id);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /** Drag an existing shape. One history entry, pushed on drop. */
  const startMove = (id: string, from: Point) => {
    const original = shapes.find((s) => s.id === id);
    if (!original) return;
    let moved = original;
    const move = (ev: PointerEvent) => {
      const to = pointAt(ev);
      moved = translateShape(original, to.x - from.x, to.y - from.y);
      setDraft(moved);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDraft(null);
      if (moved !== original) {
        commit(historyRef.current.shapes.map((s) => (s.id === id ? moved : s)));
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // While moving, the dragged shape is drawn from `draft` and hidden from the
  // committed list, so it does not appear twice.
  const drawn = draft && shapes.some((s) => s.id === draft.id) ? shapes.filter((s) => s.id !== draft.id) : shapes;
  const rendered = draft ? [...drawn, draft] : drawn;

  // ── Editing ────────────────────────────────────────────────────────────

  const remove = useCallback(
    (id: string) => {
      commit(historyRef.current.shapes.filter((s) => s.id !== id));
      setSelected(null);
    },
    [commit],
  );

  const recolour = (colour: string) => {
    setStyle((s) => ({ ...s, colour }));
    if (selected) {
      commit(historyRef.current.shapes.map((s) => (s.id === selected ? { ...s, colour } : s)));
    }
  };

  const resize = (step: number) => {
    setStyle((s) => ({ ...s, step }));
    if (selected) {
      commit(
        historyRef.current.shapes.map((s) =>
          s.id !== selected
            ? s
            : s.kind === "text"
              ? { ...s, size: fontSize(image, step) }
              : s.kind === "redact"
                ? s
                : { ...s, width: strokeWidth(image, step) },
        ),
      );
    }
  };

  const commitText = (value: string) => {
    if (!editingText) return;
    const trimmed = value.trim();
    // An empty text run is not a mark; drop it rather than leaving an
    // invisible shape for someone to trip over later.
    commit(
      trimmed === ""
        ? historyRef.current.shapes.filter((s) => s.id !== editingText.id)
        : historyRef.current.shapes.map((s) =>
            s.id === editingText.id && s.kind === "text" ? { ...s, text: trimmed } : s,
          ),
    );
    setEditingText(null);
  };

  const undo = useCallback(() => {
    if (historyRef.current.undo()) {
      setSelected(null);
      bump((n) => n + 1);
    }
  }, []);

  const redo = useCallback(() => {
    if (historyRef.current.redo()) {
      setSelected(null);
      bump((n) => n + 1);
    }
  }, []);

  // ── Keyboard ───────────────────────────────────────────────────────────
  // Bound to this container, not the document, and stopped here: Drawer listens
  // for Escape on the document, so the editor must get first refusal and only
  // let it through when it has nothing of its own to cancel.

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editingText) return; // the input owns the keyboard while it is open
    const meta = e.ctrlKey || e.metaKey;

    if (meta && e.key.toLowerCase() === "z") {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (meta && e.key.toLowerCase() === "y") {
      e.preventDefault();
      e.stopPropagation();
      redo();
      return;
    }
    if (e.key === "Escape") {
      if (selected) {
        e.stopPropagation();
        setSelected(null);
      }
      return; // otherwise let Drawer close
    }
    if ((e.key === "Delete" || e.key === "Backspace") && selected) {
      e.preventDefault();
      remove(selected);
      return;
    }
    const match = TOOLS.find((t) => t.key.toLowerCase() === e.key.toLowerCase());
    if (match && !meta) setTool(match.tool);
  };

  // Focus the container so the shortcuts work without a click first. Drawer
  // focuses its first button on open, which would be the Select tool.
  useEffect(() => {
    stageRef.current?.parentElement?.focus();
  }, []);

  // ── Size readout ───────────────────────────────────────────────────────
  // Lazily, well after the last change: toBlob on a 2560x1440 PNG is 150-400ms
  // and re-running it on every stroke would make drawing feel heavy.

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const enc = await chooseEncoding(capture.bitmap, rendered, image);
        if (!cancelled) setEstimate({ bytes: enc.blob.size, type: enc.encoding.type });
      } catch {
        /* the readout is a nicety; a failure here must not break editing */
      }
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shapes, capture.bitmap]);

  // ── Saving ─────────────────────────────────────────────────────────────

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const { blob, encoding } = await chooseEncoding(capture.bitmap, shapes, image);
      const name = `screenshot-${Date.now()}.${extensionFor(encoding.type)}`;
      await onSave(new File([blob], name, { type: encoding.type }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the screenshot.");
      setSaving(false);
    }
  };

  const surfaceHint =
    capture.source === "tab" && capture.surface && capture.surface !== "browser"
      ? "That captured a whole window. Use Redact to cover anything that should not be shared."
      : null;

  return (
    <Drawer
      open
      title="Annotate screenshot"
      onClose={onCancel}
      width={1280}
      className="shot-drawer"
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={saving} onClick={save}>
            {saving ? "Saving…" : "Attach screenshot"}
          </button>
        </>
      }
    >
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <div className="shot-editor" tabIndex={-1} onKeyDown={onKeyDown}>
        <div className="shot-toolbar">
          <div className="shot-group">
            {TOOLS.map((t) => (
              <button
                key={t.tool}
                type="button"
                className={`btn small ghost${tool === t.tool ? " is-on" : ""}`}
                title={`${t.label} (${t.key})`}
                onClick={() => setTool(t.tool)}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="shot-group shot-swatches">
            {PALETTE.map((colour) => (
              <button
                key={colour}
                type="button"
                className={`shot-swatch${style.colour === colour ? " is-on" : ""}`}
                style={{ background: colour }}
                aria-label={`Colour ${colour}`}
                onClick={() => recolour(colour)}
              />
            ))}
          </div>

          <div className="shot-group">
            {["S", "M", "L"].map((label, step) => (
              <button
                key={label}
                type="button"
                className={`btn small ghost${style.step === step ? " is-on" : ""}`}
                onClick={() => resize(step)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="shot-group">
            <button type="button" className="btn small ghost" onClick={undo} disabled={!historyRef.current.canUndo()}>
              Undo
            </button>
            <button type="button" className="btn small ghost" onClick={redo} disabled={!historyRef.current.canRedo()}>
              Redo
            </button>
            <button
              type="button"
              className="btn small ghost"
              onClick={() => selected && remove(selected)}
              disabled={!selected}
            >
              Delete
            </button>
          </div>

          <span className="shell-spacer" />
          <span className="shot-meta">
            {image.width}×{image.height}
            {estimate ? ` · ${estimate.type === "image/png" ? "PNG" : "JPEG"} · ${formatSize(estimate.bytes)}` : ""}
          </span>
        </div>

        {surfaceHint && <div className="status-banner">{surfaceHint}</div>}
        {error && <div className="status-banner warn">{error}</div>}

        <div className="shot-stage" ref={stageRef}>
          <div
            className="shot-image"
            style={{ aspectRatio: `${image.width} / ${image.height}`, maxWidth: image.width }}
          >
            <canvas ref={canvasRef} />
            <svg
              ref={svgRef}
              viewBox={`0 0 ${image.width} ${image.height}`}
              className={`shot-svg tool-${tool}`}
              onPointerDown={onPointerDown}
            >
              {rendered.map((shape) => (
                <ShapeNode key={shape.id} shape={shape} selected={shape.id === selected} image={image} />
              ))}
            </svg>

            {editingText && <TextInput editing={editingText} shapes={rendered} image={image} onCommit={commitText} />}
          </div>
        </div>
      </div>
    </Drawer>
  );
}

/**
 * One shape, in SVG. Mirrors drawShape() in render.ts -- same order, same
 * geometry helpers, same halo. The halo is a second, wider stroke underneath
 * (paint-order: stroke for text), which is what keeps a mark legible on both a
 * white page and a dark one.
 */
function ShapeNode({ shape, selected, image }: { shape: Shape; selected: boolean; image: ImageSize }) {
  const halo = "rgba(0,0,0,0.55)";
  const outline = selected ? <SelectionOutline shape={shape} image={image} /> : null;

  switch (shape.kind) {
    case "arrow": {
      const head = arrowHead(shape.from, shape.to, shape.width);
      const points = head.map((p) => `${p.x},${p.y}`).join(" ");
      return (
        <g className="shot-shape">
          <line
            x1={shape.from.x}
            y1={shape.from.y}
            x2={shape.to.x}
            y2={shape.to.y}
            stroke={halo}
            strokeWidth={shape.width * 2.1}
            strokeLinecap="round"
          />
          <polygon points={points} fill={halo} stroke={halo} strokeWidth={shape.width * 1.6} strokeLinejoin="round" />
          <line
            x1={shape.from.x}
            y1={shape.from.y}
            x2={shape.to.x}
            y2={shape.to.y}
            stroke={shape.colour}
            strokeWidth={shape.width}
            strokeLinecap="round"
          />
          <polygon points={points} fill={shape.colour} />
          {/* Invisible fat stroke so a thin arrow is still clickable -- the
              same trick UseCaseDiagram uses for its association lines. */}
          <line
            className="shot-hit"
            x1={shape.from.x}
            y1={shape.from.y}
            x2={shape.to.x}
            y2={shape.to.y}
            strokeWidth={shape.width * 6}
          />
          {outline}
        </g>
      );
    }

    case "rect": {
      const r = normRect(shape.a, shape.b);
      return (
        <g className="shot-shape">
          <rect {...r} fill="none" stroke={halo} strokeWidth={shape.width * 2.1} />
          <rect {...r} fill="none" stroke={shape.colour} strokeWidth={shape.width} />
          <rect className="shot-hit" {...r} strokeWidth={shape.width * 6} />
          {outline}
        </g>
      );
    }

    case "freehand": {
      const d = pathD(shape.points);
      return (
        <g className="shot-shape">
          <path d={d} fill="none" stroke={halo} strokeWidth={shape.width * 2.1} strokeLinecap="round" strokeLinejoin="round" />
          <path d={d} fill="none" stroke={shape.colour} strokeWidth={shape.width} strokeLinecap="round" strokeLinejoin="round" />
          <path className="shot-hit" d={d} strokeWidth={shape.width * 6} />
          {outline}
        </g>
      );
    }

    case "text":
      return (
        <g className="shot-shape">
          <text
            className="shot-text"
            x={shape.at.x}
            y={shape.at.y}
            fontSize={shape.size}
            fill={shape.colour}
            stroke={halo}
            strokeWidth={Math.max(2, shape.size * 0.16)}
          >
            {shape.text}
          </text>
          {outline}
        </g>
      );

    case "redact": {
      const r = normRect(shape.a, shape.b);
      return (
        <g className="shot-shape">
          <rect {...r} fill="#000000" />
          {outline}
        </g>
      );
    }
  }
}

function SelectionOutline({ shape, image }: { shape: Shape; image: ImageSize }) {
  const b = boundsOf(shape);
  const pad = outlineWidth(image) * 4;
  return (
    <rect
      className="shot-selected"
      x={b.x - pad}
      y={b.y - pad}
      width={b.width + pad * 2}
      height={b.height + pad * 2}
      strokeWidth={outlineWidth(image)}
      strokeDasharray={`${pad} ${pad / 2}`}
    />
  );
}

/** An HTML input floated over the text shape being typed. Real text editing
 *  with a real caret, rather than a hand-rolled one on a canvas. */
function TextInput({
  editing,
  shapes,
  image,
  onCommit,
}: {
  editing: { id: string; value: string };
  shapes: readonly Shape[];
  image: ImageSize;
  onCommit: (value: string) => void;
}) {
  const [value, setValue] = useState(editing.value);
  const shape = shapes.find((s) => s.id === editing.id);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  if (!shape || shape.kind !== "text") return null;
  return (
    <input
      ref={ref}
      className="shot-text-input"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onCommit(value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") onCommit(value);
        if (e.key === "Escape") onCommit("");
      }}
      style={{
        left: `${(shape.at.x / image.width) * 100}%`,
        top: `${((shape.at.y - shape.size) / image.height) * 100}%`,
        fontSize: `${(shape.size / image.height) * 100}cqh`,
        color: shape.colour,
      }}
    />
  );
}

/** A stray click that produced no real mark. */
function isDegenerate(shape: Shape): boolean {
  switch (shape.kind) {
    case "arrow":
      return Math.hypot(shape.to.x - shape.from.x, shape.to.y - shape.from.y) < 2;
    case "rect":
    case "redact": {
      const r = normRect(shape.a, shape.b);
      return r.width < 2 && r.height < 2;
    }
    case "freehand":
      return shape.points.length < 2;
    case "text":
      return shape.text === "";
  }
}

/** Walk the ladder until something fits the budget; always return something. */
async function chooseEncoding(
  bitmap: ImageBitmap,
  shapes: readonly Shape[],
  image: ImageSize,
): Promise<{ blob: Blob; encoding: Encoding }> {
  const ladder = encodingLadder(image);
  let last: { blob: Blob; encoding: Encoding } | null = null;
  for (const encoding of ladder) {
    const blob = await flatten(bitmap, shapes, encoding);
    last = { blob, encoding };
    if (blob.size <= TARGET_BYTES) return last;
  }
  return last!;
}
