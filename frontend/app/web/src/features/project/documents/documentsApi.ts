// Client for a project's documents (backend app/studio/documents.py). The
// file itself goes browser -> S3; see uploadDocument.ts for the whole flow.
import { apiDelete, apiGet, apiPost } from "../../../core/api";
import { putToPresignedUrl } from "../../../core/upload";

export interface ProjectDocument {
  id: string;
  project_id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  status: "pending" | "uploaded";
  uploaded_by: string | null;
  created_at: string;
  confirmed_at: string | null;
}

export interface UploadTicket {
  document: ProjectDocument;
  upload_url: string;
  method: "PUT";
  headers: Record<string, string>;
  expires_in: number;
}

/** What the file picker accepts; must agree with ALLOWED_TYPES on the server. */
export const ACCEPTED_EXTENSIONS = ".txt,.md,.pdf,.docx,.png,.jpg,.jpeg";

const base = (projectId: string) => `/studio/projects/${projectId}/documents`;

export const listDocuments = (projectId: string) => apiGet<ProjectDocument[]>(base(projectId));
export const createDocument = (projectId: string, input: { filename: string; content_type: string; size_bytes: number }) =>
  apiPost<UploadTicket>(base(projectId), input);
export const confirmDocument = (projectId: string, documentId: string) =>
  apiPost<ProjectDocument>(`${base(projectId)}/${documentId}/confirm`, {});
export const getDownloadUrl = (projectId: string, documentId: string) =>
  apiGet<{ url: string; expires_in: number }>(`${base(projectId)}/${documentId}/download`);
export const deleteDocument = (projectId: string, documentId: string) => apiDelete(`${base(projectId)}/${documentId}`);

export type UploadPhase = "requesting" | "uploading" | "confirming";

/**
 * The full upload: ask the API for a ticket, PUT the file to S3, confirm.
 * Resolves to the confirmed document; throws with a readable message.
 */
export async function uploadDocument(
  projectId: string,
  file: File,
  opts: { onPhase?: (phase: UploadPhase) => void; signal?: AbortSignal } = {},
): Promise<ProjectDocument> {
  opts.onPhase?.("requesting");
  const ticket = await createDocument(projectId, {
    filename: file.name,
    content_type: file.type,
    size_bytes: file.size,
  });
  opts.onPhase?.("uploading");
  await putToPresignedUrl(ticket.upload_url, file, ticket.headers, opts.signal);
  opts.onPhase?.("confirming");
  return confirmDocument(projectId, ticket.document.id);
}
