// A centred lightbox for an attachment -- image, PDF, video, audio, text,
// Word or Excel -- with ‹ › and the arrow keys to page through the entity's
// other attachments. Bytes come from the presigned download URL, so
// everything renders from an object URL we own and revoke. Ported from the
// reference app's previewAttachment() (static/js/attachments.js).
import { KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { attachmentDownloadUrl, BoardAttachment } from "../attachmentsApi";
import { formatBytes } from "../../../core/format";
import { attExt, attMime, previewKindFor, PREVIEW_TEXT_LIMIT } from "./previewKinds";
import { useBoard } from "./boardData";
import { useModalHold } from "./dialogs";
import { renderDocx, renderXlsx } from "./officePreview";

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), iframe, video[controls], audio[controls], [tabindex]:not([tabindex="-1"])';

interface AttachmentPreviewProps {
  items: BoardAttachment[];
  initialIndex: number;
  onClose: () => void;
}

type Shown =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "text"; text: string; truncated: boolean }
  | { kind: "media"; tag: "img" | "iframe" | "video" | "audio"; url: string; mime: string }
  | { kind: "dom"; el: HTMLElement }
  | { kind: "none"; what: string; contentType: string };

export function AttachmentPreview({ items, initialIndex, onClose }: AttachmentPreviewProps) {
  const { projectId, index } = useBoard();
  const [i, setI] = useState(Math.max(0, Math.min(initialIndex, items.length - 1)));
  const [shown, setShown] = useState<Shown>({ kind: "loading" });
  const seq = useRef(0);
  const urlRef = useRef<string | null>(null);
  const domHost = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // The lightbox owns Escape while it is up: a drawer beneath treats it as
  // it would a dialog and leaves the key alone (the reference's dialog
  // stack, core.js).
  useModalHold();

  // Take keyboard focus on open, as the reference's close.focus() does --
  // Enter or Space then closes, Tab walks the viewer's own controls -- and
  // hand it back to wherever it came from on close.
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeBtn.current?.focus();
    return () => before?.focus();
  }, []);

  // Tab cycles within the viewer rather than walking the page behind it.
  const trapTab = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab" || !viewRef.current) return;
    const focusable = Array.from(viewRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const dropUrl = () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
  };

  const at = items[i];

  useEffect(() => {
    let cancelled = false;
    const mine = ++seq.current;
    dropUrl();
    setShown({ kind: "loading" });
    (async () => {
      let blob: Blob;
      try {
        const { url } = await attachmentDownloadUrl(projectId, at.id);
        const r = await fetch(url);
        if (!r.ok) throw new Error(String(r.status));
        blob = await r.blob();
      } catch (e) {
        if (!cancelled && mine === seq.current) setShown({ kind: "error", message: `Couldn't load this file (${e instanceof Error ? e.message : "error"}).` });
        return;
      }
      if (cancelled || mine !== seq.current) return;
      const kind = previewKindFor(at);
      if (kind === "text") {
        const text = await blob.slice(0, PREVIEW_TEXT_LIMIT).text();
        if (cancelled || mine !== seq.current) return;
        setShown({ kind: "text", text, truncated: blob.size > PREVIEW_TEXT_LIMIT });
        return;
      }
      if (kind === "docx" || kind === "xlsx") {
        try {
          const buf = await blob.arrayBuffer();
          const el = kind === "docx" ? await renderDocx(buf) : await renderXlsx(buf);
          if (cancelled || mine !== seq.current) return;
          setShown({ kind: "dom", el });
        } catch {
          if (!cancelled && mine === seq.current) {
            setShown({ kind: "error", message: "Couldn't convert this file — it may be corrupt, or saved in an older format. Download it to open." });
          }
        }
        return;
      }
      if (!kind) {
        const ext = attExt(at);
        setShown({ kind: "none", what: ext ? `.${ext} files` : "this file type", contentType: at.content_type });
        return;
      }
      // The object URL takes its type from the blob; re-wrap when the stored
      // type says nothing so a PDF renders instead of downloading itself.
      const mime = attMime(at);
      const url = URL.createObjectURL(blob.type === mime ? blob : new Blob([blob], { type: mime }));
      urlRef.current = url;
      setShown({ kind: "media", tag: { image: "img", pdf: "iframe", video: "video", audio: "audio" }[kind] as "img" | "iframe" | "video" | "audio", url, mime });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at.id, projectId]);

  useEffect(() => () => dropUrl(), []);

  // Mount a converted document into the body when one arrives.
  useEffect(() => {
    const host = domHost.current;
    if (!host) return;
    host.replaceChildren();
    if (shown.kind === "dom") host.appendChild(shown.el);
  }, [shown]);

  // Escape closes the viewer whatever holds focus -- in the capture phase and
  // stopped there, so a drawer underneath does not also see it, as the
  // reference's dialog stack swallows the key before anything else. ‹/› as
  // arrow keys, but not while a field behind the backdrop still holds focus.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        ev.stopPropagation();
        closeRef.current();
        return;
      }
      const t = ev.target as HTMLElement | null;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      if (ev.key === "ArrowLeft") {
        ev.preventDefault();
        setI((x) => Math.max(0, x - 1));
      } else if (ev.key === "ArrowRight") {
        ev.preventDefault();
        setI((x) => Math.min(items.length - 1, x + 1));
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [items.length]);

  const download = async () => {
    const { url } = await attachmentDownloadUrl(projectId, at.id);
    window.open(url, "_blank", "noopener");
  };

  const body = (() => {
    switch (shown.kind) {
      case "loading":
        return "loading…";
      case "error":
        return <div className="hempty">{shown.message}</div>;
      case "text":
        return <pre>{shown.text + (shown.truncated ? "\n\n… truncated — download for the rest." : "")}</pre>;
      case "none":
        return (
          <div className="hempty" title={shown.contentType}>
            The browser can't preview {shown.what} — download it to open.
          </div>
        );
      case "dom":
        return null;
      case "media": {
        const fail = () => setShown({ kind: "error", message: `This browser can't play ${shown.mime} — download it to open.` });
        if (shown.tag === "img") return <img src={shown.url} alt={at.filename} onError={fail} />;
        if (shown.tag === "iframe") return <iframe src={shown.url} title={at.filename} />;
        if (shown.tag === "video") return <video src={shown.url} controls onError={fail} />;
        return <audio src={shown.url} controls onError={fail} />;
      }
    }
  })();

  return createPortal(
    <div className="board-lightbox" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={viewRef} className="att-view" role="dialog" aria-modal="true" aria-label={at.filename} onKeyDown={trapTab}>
        <div className="att-view-head">
          <h3>{at.filename}</h3>
          <span className="att-view-meta">
            {formatBytes(at.size_bytes)} · {index.memberName(at.created_by)}
          </span>
        </div>
        <div className="att-view-body">
          {body}
          <div ref={domHost} style={{ display: shown.kind === "dom" ? "contents" : "none" }} />
        </div>
        <div className="att-view-foot">
          {items.length > 1 && (
            <>
              <button type="button" className="btn mini-x" disabled={i === 0} onClick={() => setI(i - 1)}>
                ‹
              </button>
              <button type="button" className="btn mini-x" disabled={i === items.length - 1} onClick={() => setI(i + 1)}>
                ›
              </button>
              <span className="att-view-count">
                {i + 1} / {items.length}
              </span>
            </>
          )}
          <button type="button" className="btn mini-x sp" onClick={() => void download()}>
            Download
          </button>
          <button ref={closeBtn} type="button" className="btn mini-x primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
