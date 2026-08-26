// The active scope (organisation = "account", workspace = "space") that
// scoped API calls run under. The auth module resolves membership and
// permissions from the X-Scope-Type / X-Scope-ID headers, so rather than each
// feature remembering to attach them, core/api.ts reads the value held here.
//
// This is a plain module (not React context) so non-component code -- the
// studio sync outbox in particular -- can make scoped calls too. The
// SessionProvider keeps it in step with the UI's current selection.

export type ScopeType = "account" | "space";

export interface ActiveScope {
  type: ScopeType;
  id: string;
}

let active: ActiveScope | null = null;

export function setActiveScope(scope: ActiveScope | null): void {
  active = scope;
}

export function getActiveScope(): ActiveScope | null {
  return active;
}

/**
 * Headers for a request. `undefined` means "use the active scope";
 * `null` means "send none" (user-scoped endpoints such as /me or /tenants/my).
 */
export function scopeHeaders(override?: ActiveScope | null): Record<string, string> {
  const scope = override === undefined ? active : override;
  return scope ? { "X-Scope-Type": scope.type, "X-Scope-ID": scope.id } : {};
}
