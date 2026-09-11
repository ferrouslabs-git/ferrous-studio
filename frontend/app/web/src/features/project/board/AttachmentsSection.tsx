// The attachments widget mounted on epics, features, requirements and docs:
// one list/upload/download/preview path for all of them. Ported from the
// reference app's attachments.js; storage here is S3 via the presign flow
// in attachmentsApi.ts.
import { useRef, useState } from "react";
import { errorMessage } from "../../../core/api";
import { formatBytes } from "../../../core/format";
import { useLoad } from "../../../core/useLoad";
import { attachmentDownloadUrl, AttachmentEntityType, BoardAttachment, deleteAttachment, listAttachments, uploadAttachment } from "../attachmentsApi";
import { AttachmentPreview } from "./AttachmentPreview";
import { useBoard } from "./boardData";
import { useDialogs } from "./dialogs";
import { useToast } from "./toast";

export function AttachmentsSection({ entityType, entityId }: { entityType: AttachmentEntityType; entityId: string }) {
  const { projectId, index, canWrite } = useBoard();
  const toast = useToast();
  const dialogs = useDialogs();
  const attachments = useLoad(() => listAttachments(projectId, entityType, entityId), [projectId, entityType, entityId]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      await uploadAttachment(projectId, entityType, entityId, file);
      toast("attachment uploaded");
      await attachments.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

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

  return (
    <div className="att-section">
      <div className="section-row">
        <h4 className="att-h">Attachments</h4>
        {canWrite && (
          <>
            <button type="button" className="btn mini-x" disabled={uploading} onClick={() => fileInput.current?.click()}>
              {uploading ? "Uploading…" : "+ Attach file"}
            </button>
            <input ref={fileInput} type="file" style={{ display: "none" }} onChange={(e) => void onFile(e.target.files?.[0])} />
          </>
        )}
      </div>
      <div className="att-list">
        {attachments.loading && <div className="hempty">loading…</div>}
        {attachments.error && <div className="hempty">Couldn't load attachments.</div>}
        {!attachments.loading && !attachments.error && rows.length === 0 && <div className="hempty">No attachments yet.</div>}
        {rows.map((a, i) => (
          <div key={a.id} className="hrow" title="click to preview" onClick={() => setPreview(i)}>
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
      {error && <div className="status-banner warn">{error}</div>}
      {preview !== null && rows[preview] && <AttachmentPreview items={rows} initialIndex={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
