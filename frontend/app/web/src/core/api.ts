// Thin fetch wrapper for /api/*. Adds the bearer token, the active scope
// headers (see scope.ts), central 401 handling, and typed errors so callers
// can react to 403/409/422 bodies rather than a bare "Request failed".
import { ApiError } from "./apiError";
import { authService } from "./auth";
import { ActiveScope, scopeHeaders } from "./scope";

export { ApiError, errorMessage } from "./apiError";

export interface RequestOptions {
  /** Override the scope: an explicit scope, or `null` to send no scope headers. */
  scope?: ActiveScope | null;
  headers?: Record<string, string>;
  /** Abort the request from an effect cleanup (e.g. a superseded page fetch). */
  signal?: AbortSignal;
}

function detailOf(body: unknown): string | null {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
  }
  return null;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  opts: RequestOptions = {},
): Promise<T> {
  const token = await authService.getValidToken();
  const headers: Record<string, string> = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...scopeHeaders(opts.scope),
    ...(opts.headers ?? {}),
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(`/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: opts.signal,
  });

  if (response.status === 401) {
    authService.handleExpiredSession();
    throw new ApiError(401, null, "Session expired");
  }
  if (!response.ok) {
    let parsed: unknown = null;
    try {
      parsed = await response.json();
    } catch {
      // Non-JSON error body; leave parsed as null.
    }
    throw new ApiError(response.status, parsed, detailOf(parsed) ?? `Request failed: ${response.status}`);
  }
  // 204s and some DELETEs have no body.
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const apiGet = <T>(path: string, opts?: RequestOptions) => request<T>("GET", path, undefined, opts);
export const apiPost = <T>(path: string, body: unknown, opts?: RequestOptions) =>
  request<T>("POST", path, body, opts);
export const apiPut = <T>(path: string, body: unknown, opts?: RequestOptions) =>
  request<T>("PUT", path, body, opts);
export const apiPatch = <T>(path: string, body: unknown, opts?: RequestOptions) =>
  request<T>("PATCH", path, body, opts);
export const apiDelete = (path: string, opts?: RequestOptions) =>
  request<void>("DELETE", path, undefined, opts);
