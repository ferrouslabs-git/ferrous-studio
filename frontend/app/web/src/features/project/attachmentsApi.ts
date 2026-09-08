// Client for board attachments (backend app/studio/board/routes.py).
//
// Board-wide rather than feedback-specific -- releases, epics, requirements and
// docs can all own attachments -- so it sits here rather than inside a feature
// folder the next consumer would have to import out of.
import { apiDelete, apiGet, apiPost } from "../../core/api";
import { putToPresignedUrl } from "../../core/upload";

export type AttachmentEntityType = "release" | "epic" | "feature" | "requirement" | "doc" | "feedback";

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
  /** What the PUT must send. The presign signs the canonical content type,
   *  which is not always the one the client asked with, so these are the
   *  server's headers and must be passed through unchanged. */
  headers: Record<string, string>;
  expires_in: number;
}

/** The three phases of an upload, mirroring documentsApi's uploadDocument. */
export type UploadPhase = "requesting" | "uploading" | "confirming";

const base = (projectId: string) => `/studio/projects/${projectId}/board/attachments`;

export const listAttachments = (projectId: string, entityType: AttachmentEntityType, entityId: string) =>
  apiGet<BoardAttachment[]>(`${base(projectId)}?entity_type=${entityType}&entity_id=${entityId}`);

export const deleteAttachment = (projectId: string, attachmentId: string) =>
  apiDelete(`${base(projectId)}/${attachmentId}`);

/** A short-lived presigned S3 URL. Opening it downloads the file, by design --
 *  presign_get forces Content-Disposition: attachment. */
export const attachmentDownloadUrl = (projectId: string, attachmentId: string) =>
  apiGet<{ url: string; expires_in: number }>(`${base(projectId)}/${attachmentId}/download`);

/**
 * A saved attachment as a decoded bitmap, ready to draw into a canvas.
 *
 * Deliberately not an `<img src>`. Every studio route is scoped by
 * X-Scope-Type/X-Scope-ID headers, which an `<img>` cannot send -- so no
 * same-origin image URL can work here without inventing a second way to
 * authorise a request. And the presigned URL is cross-origin, which the app's
 * CSP (`img-src 'self' data:`) refuses.
 *
 * Fetching the bytes and decoding them sidesteps both: the scoped call that
 * mints the URL carries its headers as usual, the fetch to S3 is already
 * allowed by `connect-src` and the bucket's CORS rule, and a canvas needs no
 * `img-src` at all. It is also how a screenshot is drawn before it is
 * uploaded, so saved and unsaved ones render through one path.
 */
export async function loadAttachmentBitmap(
  projectId: string,
  attachmentId: string,
): Promise<{ blob: Blob; bitmap: ImageBitmap }> {
  const { url } = await attachmentDownloadUrl(projectId, attachmentId);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load the screenshot (${response.status})`);
  const blob = await response.blob();
  return { blob, bitmap: await createImageBitmap(blob) };
}

/**
 * Ticket, then a PUT straight to S3, then confirm -- the same three steps as
 * uploadDocument, against the board's attachment routes.
 *
 * The ticket must be minted from the FINAL file: the presign signs both the
 * content type and the byte length, so a file that changes after this is
 * called gets a bare 403 from S3.
 */
export async function uploadAttachment(
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
