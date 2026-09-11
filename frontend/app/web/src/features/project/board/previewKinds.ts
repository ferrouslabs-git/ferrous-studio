// What the preview lightbox can show, and how it decides. Ported from the
// reference app's static/js/attachments.js.
import type { BoardAttachment } from "../attachmentsApi";

export const PREVIEW_TEXT_LIMIT = 256 * 1024; // don't paste 10MB into the DOM
export const SHEET_ROW_LIMIT = 500; // a 50k-row sheet is not a preview

// Extensions we are willing to infer a type from: a fixed list of formats
// where being wrong is harmless (the browser simply fails to decode).
export const EXT_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  ogv: "video/ogg",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  log: "text/plain",
  json: "application/json",
  yaml: "text/yaml",
  yml: "text/yaml",
  xml: "text/xml",
  html: "text/plain",
  css: "text/plain",
  js: "text/plain",
  ts: "text/plain",
  py: "text/plain",
  sql: "text/plain",
  sh: "text/plain",
  ps1: "text/plain",
  toml: "text/plain",
  ini: "text/plain",
  env: "text/plain",
};

// Filename extension, lowercased, no dot ("diagram.PNG" -> "png"; none -> "").
export const attExt = (a: Pick<BoardAttachment, "filename">): string =>
  (a.filename || "").toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";

// Best MIME type available: the stored one when it actually says something,
// the extension's otherwise. "" when neither does.
export function attMime(a: Pick<BoardAttachment, "filename" | "content_type">): string {
  const ct = (a.content_type || "").toLowerCase().split(";")[0].trim();
  const vague = !ct || ct === "application/octet-stream" || ct === "binary/octet-stream";
  return (vague ? EXT_MIME[attExt(a)] : ct) ?? "";
}

export type PreviewKind = "image" | "pdf" | "video" | "audio" | "text" | "docx" | "xlsx";

// Null for anything nothing here can render -- it gets a "download to open"
// card, never a dead click.
export function previewKindFor(a: Pick<BoardAttachment, "filename" | "content_type">): PreviewKind | null {
  const ct = attMime(a);
  if (ct.startsWith("image/")) return "image";
  if (ct.startsWith("video/")) return "video";
  if (ct.startsWith("audio/")) return "audio";
  if (ct === "application/pdf") return "pdf";
  if (ct === EXT_MIME.docx) return "docx";
  if (ct === EXT_MIME.xlsx || ct === EXT_MIME.xls) return "xlsx";
  if (ct.startsWith("text/") || /^application\/(json|xml|.*\+xml|x-yaml|yaml|javascript|x-sh|sql)$/.test(ct)) return "text";
  return null;
}
