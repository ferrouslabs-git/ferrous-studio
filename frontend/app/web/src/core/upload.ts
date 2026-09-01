// Direct-to-S3 upload against a presigned URL. Deliberately *not* core/api.ts:
// the request goes to S3, not /api, so it must carry no bearer token and no
// scope headers (S3 rejects headers that were not part of the signature), and
// the body is the raw file, not JSON. The Content-Type must be exactly what
// the API signed, which is why the ticket hands it back.
export async function putToPresignedUrl(
  url: string,
  file: Blob,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(url, { method: "PUT", body: file, headers, signal, mode: "cors" });
  if (!response.ok) {
    throw new Error(
      response.status === 403
        ? "Upload rejected: the file changed or the link expired. Try again."
        : `Upload failed (${response.status})`,
    );
  }
}
