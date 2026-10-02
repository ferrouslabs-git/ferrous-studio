// The attachments widget mounted on epics (the epic column), features (a
// group card's fold-out) and requirements (the pane and the drawer): one
// list/upload/download/preview path for all of them. Docs accept attachments
// on the API but have no surface for them yet. Ported from the reference
// app's attachments.js; storage here is S3 via the presign flow in
// attachmentsApi.ts.
//
// Files come in through the picker (several at once) or by dropping them on
// the section. Images get a thumbnail strip above the list, drawn into a
// canvas for the reason loadAttachmentBitmap() gives. PendingAttachments is
// the same control for an item that does not exist yet: it only holds the
// files, and the caller uploads them once the item has an id. The drop hook,
// the attach button and the thumbnail are exported for the comment composer
// (CommentsList), which attaches files the same way.
import { ClipboardEvent, DragEvent, useEffect, useRef, useState } from "react";
import { errorMessage } from "../../../core/api";
import { formatBytes } from "../../../core/format";
import { useLoad } from "../../../core/useLoad";
import {
  attachmentDownloadUrl,
  AttachmentEntityType,
  BoardAttachment,
  deleteAttachment,
  listAttachments,
  loadAttachmentBitmap,
  uploadAll,
} from "../attachmentsApi";
import { useAttachmentPreview } from "./AttachmentPreview";
import { useBoard } from "./boardData";
import { useDialogs } from "./dialogs";
import { previewKindFor } from "./previewKinds";
import { useToast } from "./toast";

/** Drag-and-drop of files onto an element: whether one is over it, and the handlers to spread on it. */
export function useFileDrop(onFiles: (files: File[]) => void, disabled: boolean) {
  const [over, setOver] = useState(false);
  // dragenter/dragleave fire for every child crossed, so count them.
  const depth = useRef(0);
  const carriesFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes("Files");
  const handlers = disabled
    ? {}
    : {
        onDragEnter: (e: DragEvent) => {
          if (!carriesFiles(e)) return;
          e.preventDefault();
          depth.current++;
          setOver(true);
        },
        onDragOver: (e: DragEvent) => {
          if (!carriesFiles(e)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        },
        onDragLeave: (e: DragEvent) => {
          if (!carriesFiles(e)) return;
          depth.current = Math.max(0, depth.current - 1);
          if (depth.current === 0) setOver(false);
        },
        onDrop: (e: DragEvent) => {
          if (!carriesFiles(e)) return;
          e.preventDefault();
          depth.current = 0;
          setOver(false);
          const files = Array.from(e.dataTransfer.files);
          if (files.length) onFiles(files);
        },
      };
  return { over, handlers };
}

/**
 * An onPaste handler that turns pasted files (a screenshot on the clipboard)
 * into attachments; a paste of text is left alone. Clipboard images all arrive
 * as "image.png", so they are renamed to tell a batch of them apart.
 */
export function pasteFiles(onFiles: (files: File[]) => void, disabled = false) {
  return (e: ClipboardEvent) => {
    if (disabled) return;
    const pasted = Array.from(e.clipboardData.files);
    if (!pasted.length) return;
    e.preventDefault();
    const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
    onFiles(
      pasted.map((f, i) =>
        f.name === "image.png" ? new File([f], `pasted-${stamp}${pasted.length > 1 ? `-${i + 1}` : ""}.png`, { type: f.type }) : f,
      ),
    );
  };
}

export function AttachButton({ busy, label, onFiles }: { busy: boolean; label: string; onFiles: (files: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className="btn mini-x" disabled={busy} onClick={() => input.current?.click()}>
        {label}
      </button>
      <input
        ref={input}
        type="file"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) onFiles(files);
        }}
      />
    </>
  );
}

export function AttachmentsSection({ entityType, entityId }: { entityType: AttachmentEntityType; entityId: string }) {
  const { projectId, index, canWrite } = useBoard();
  const toast = useToast();
  const dialogs = useDialogs();
  const attachments = useLoad(() => listAttachments(projectId, entityType, entityId), [projectId, entityType, entityId]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const preview = useAttachmentPreview();

  const onFiles = async (files: File[]) => {
    if (progress) return;
    setProgress({ done: 0, total: files.length });
    try {
      const ok = (await uploadAll(projectId, entityType, entityId, files, toast, (done) => setProgress({ done, total: files.length }))).length;
      if (ok) toast(ok === 1 ? "attachment uploaded" : `${ok} attachments uploaded`);
      await attachments.reload();
    } finally {
      setProgress(null);
    }
  };
  const drop = useFileDrop((files) => void onFiles(files), !canWrite);

  const download = async (a: BoardAttachment) => {
    try {
      const { url } = await attachmentDownloadUrl(projectId, a.id);
      window.open(url, "_blank", "noopener");
    } catch (err) {
      toast(errorMessage(err), { type: "err" });
    }
  };

  const remove = async (a: BoardAttachment) => {
    if (!(await dialogs.confirm({ title: "Delete attachment", message: `Delete "${a.filename}"?`, ok: "Delete" }))) return;
    try {
      await deleteAttachment(projectId, a.id);
      await attachments.reload();
    } catch (err) {
      toast(errorMessage(err), { type: "err" });
    }
  };

  const rows = attachments.data ?? [];
  const images = rows.map((a, i) => ({ a, i })).filter(({ a }) => previewKindFor(a) === "image");

  return (
    <div className={`att-section${drop.over ? " att-drop" : ""}`} {...drop.handlers}>
      <div className="section-row">
        <h4 className="att-h">Attachments</h4>
        {canWrite && (
          <AttachButton
            busy={!!progress}
            label={progress ? (progress.total > 1 ? `Uploading ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…` : "Uploading…") : "+ Attach files"}
            onFiles={(files) => void onFiles(files)}
          />
        )}
      </div>
      {images.length > 0 && (
        <div className="att-thumbs">
          {images.map(({ a, i }) => (
            <button key={a.id} type="button" className="att-thumb" title={a.filename} onClick={() => preview.open(rows, i)}>
              <AttachmentThumb projectId={projectId} attachment={a} />
            </button>
          ))}
        </div>
      )}
      <div className="att-list">
        {attachments.loading && <div className="hempty">loading…</div>}
        {attachments.error && <div className="hempty">Couldn't load attachments.</div>}
        {!attachments.loading && !attachments.error && rows.length === 0 && <div className="hempty">No attachments yet.</div>}
        {rows.map((a, i) => (
          <div key={a.id} className="hrow" title="click to preview" onClick={() => preview.open(rows, i)}>
            <span className="t">{a.filename}</span>
            <span className="r">
              {formatBytes(a.size_bytes)} · {index.memberName(a.created_by)}
            </span>
            <button
              type="button"
              className="btn mini-x"
              title="download"
              onClick={(e) => {
                e.stopPropagation();
                void download(a);
              }}
            >
              ⬇
            </button>
            {canWrite && (
              <button
                type="button"
                className="btn mini-x danger-ink"
                title="delete"
                onClick={(e) => {
                  e.stopPropagation();
                  void remove(a);
                }}
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>
      {drop.over && <div className="att-drop-note">Drop to attach</div>}
      {preview.element}
    </div>
  );
}

/** Files chosen for an item that is not saved yet; the caller uploads them with uploadAll() once it is. */
export function PendingAttachments({ files, onChange, disabled }: { files: File[]; onChange: (files: File[]) => void; disabled?: boolean }) {
  const add = (more: File[]) => onChange([...files, ...more]);
  const drop = useFileDrop(add, !!disabled);
  return (
    <div className={`att-section${drop.over ? " att-drop" : ""}`} {...drop.handlers}>
      <div className="section-row">
        <h4 className="att-h">Attachments</h4>
        {!disabled && <AttachButton busy={false} label="+ Attach files" onFiles={add} />}
      </div>
      <div className="att-list">
        {files.length === 0 && <div className="hempty">No attachments yet.</div>}
        {files.map((f, i) => (
          <div key={`${f.name}-${f.size}-${f.lastModified}-${i}`} className="hrow">
            <span className="t">{f.name}</span>
            <span className="r">{formatBytes(f.size)} · uploads on create</span>
            {!disabled && (
              <button type="button" className="btn mini-x danger-ink" title="remove" onClick={() => onChange(files.filter((_, j) => j !== i))}>
                ✕
              </button>
            )}
          </div>
        ))}
      </div>
      {drop.over && <div className="att-drop-note">Drop to attach</div>}
    </div>
  );
}

const THUMB_W = 96;
const THUMB_H = 72;

// One image, fitted into a small canvas. Loads once per mount; a file the
// browser cannot decode leaves the frame blank rather than failing the list.
export function AttachmentThumb({ projectId, attachment }: { projectId: string; attachment: BoardAttachment }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    loadAttachmentBitmap(projectId, attachment.id)
      .then(({ bitmap }) => {
        const el = canvas.current;
        if (cancelled || !el) return bitmap.close();
        const dpr = window.devicePixelRatio || 1;
        el.width = THUMB_W * dpr;
        el.height = THUMB_H * dpr;
        const ctx = el.getContext("2d");
        if (ctx) {
          const scale = Math.min(el.width / bitmap.width, el.height / bitmap.height);
          const w = bitmap.width * scale;
          const h = bitmap.height * scale;
          ctx.drawImage(bitmap, (el.width - w) / 2, (el.height - h) / 2, w, h);
        }
        bitmap.close();
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [projectId, attachment.id]);
  return failed ? <span className="att-thumb-x">{attachment.filename}</span> : <canvas ref={canvas} style={{ width: THUMB_W, height: THUMB_H }} />;
}
