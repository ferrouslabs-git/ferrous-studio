// Client for board attachments (backend app/studio/board/routes.py) -- files
// on a release, epic, feature, requirement, or doc. Same presign-put-confirm
// flow as project documents (documentsApi.ts), reused via core/upload.ts.
import { apiDelete, apiGet, apiPost } from "../../../core/api";
import { putToPresignedUrl } from "../../../core/upload";

export type AttachmentEntityType = "release" | "epic" | "feature" | "requirement" | "doc";

export interface BoardAttachment {
  id: string;
  entity_type: AttachmentEntityType;
  entity_id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  status: "pending" | "uploaded";
  created_by: string | null;
  created_at: string;
}

interface UploadTicket {
  attachment_id: string;
  upload_url: string;
  headers: Record<string, string>;
  expires_in: number;
}

const base = (projectId: string) => `/studio/projects/${projectId}/board/attachments`;

export const listBoardAttachments = (projectId: string, entityType: AttachmentEntityType, entityId: string) =>
  apiGet<BoardAttachment[]>(`${base(projectId)}?entity_type=${entityType}&entity_id=${entityId}`);

export const getBoardAttachmentDownloadUrl = (projectId: string, attachmentId: string) =>
  apiGet<{ url: string; expires_in: number }>(`${base(projectId)}/${attachmentId}/download`);

export const deleteBoardAttachment = (projectId: string, attachmentId: string) =>
  apiDelete(`${base(projectId)}/${attachmentId}`);

export type UploadPhase = "requesting" | "uploading" | "confirming";

export async function uploadBoardAttachment(
  projectId: string,
  entityType: AttachmentEntityType,
  entityId: string,
  file: File,
  opts: { onPhase?: (phase: UploadPhase) => void; signal?: AbortSignal } = {},
): Promise<BoardAttachment> {
  opts.onPhase?.("requesting");
  const ticket = await apiPost<UploadTicket>(base(projectId), {
    entity_type: entityType,
    entity_id: entityId,
    filename: file.name,
    content_type: file.type,
    size_bytes: file.size,
  });
  opts.onPhase?.("uploading");
  await putToPresignedUrl(ticket.upload_url, file, ticket.headers, opts.signal);
  opts.onPhase?.("confirming");
  return apiPost<BoardAttachment>(`${base(projectId)}/${ticket.attachment_id}/confirm`, {});
}
