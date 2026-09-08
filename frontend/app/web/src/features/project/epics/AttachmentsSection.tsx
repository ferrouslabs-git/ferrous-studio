// Files on a release/epic/feature/requirement/doc. Reused on the epic detail
// page for both the epic itself and each of its features.
import { useRef, useState } from "react";
import { errorMessage } from "../../../core/api";
import { formatBytes } from "../../../core/format";
import { useLoad } from "../../../core/useLoad";
import {
  AttachmentEntityType,
  deleteBoardAttachment,
  getBoardAttachmentDownloadUrl,
  listBoardAttachments,
  uploadBoardAttachment,
} from "./boardAttachmentsApi";

export function AttachmentsSection({
  projectId,
  entityType,
  entityId,
  canWrite,
}: {
  projectId: string;
  entityType: AttachmentEntityType;
  entityId: string;
  canWrite: boolean;
}) {
  const attachments = useLoad(() => listBoardAttachments(projectId, entityType, entityId), [projectId, entityType, entityId]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const pick = () => fileInput.current?.click();

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      await uploadBoardAttachment(projectId, entityType, entityId, file);
      await attachments.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const download = async (attachmentId: string) => {
    const { url } = await getBoardAttachmentDownloadUrl(projectId, attachmentId);
    window.open(url, "_blank", "noopener");
  };

  const remove = async (attachmentId: string) => {
    await deleteBoardAttachment(projectId, attachmentId);
    await attachments.reload();
  };

  const rows = attachments.data ?? [];

  return (
    <div className="stack" style={{ gap: 6 }}>
      {rows.length === 0 && !attachments.loading && <span className="muted">No attachments.</span>}
      {rows.map((a) => (
        <div key={a.id} className="list-editor-row">
          <button type="button" className="btn-link" onClick={() => void download(a.id)}>
            {a.filename}
          </button>
          <span className="muted" style={{ fontSize: 12 }}>
            {formatBytes(a.size_bytes)}
          </span>
          {canWrite && (
            <button type="button" className="btn icon ghost" aria-label={`Remove ${a.filename}`} onClick={() => void remove(a.id)}>
              ×
            </button>
          )}
        </div>
      ))}
      {canWrite && (
        <div>
          <input ref={fileInput} type="file" style={{ display: "none" }} onChange={(e) => void onFile(e.target.files?.[0])} />
          <button type="button" className="btn small ghost" disabled={uploading} onClick={pick}>
            {uploading ? "Uploading…" : "+ Attach file"}
          </button>
        </div>
      )}
      {error && <div className="status-banner warn">{error}</div>}
    </div>
  );
}
