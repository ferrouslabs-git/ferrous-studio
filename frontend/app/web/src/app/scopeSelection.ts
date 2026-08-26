// Which organisation and workspace to open when a session starts.
//
// This is a product decision, not plumbing. Options with different feel:
//   - first in the list      : predictable, but a user in three orgs always
//                              lands in the same one regardless of what they
//                              were doing.
//   - remember last used     : what most multi-tenant tools do; needs a
//                              per-user key so two accounts on one browser
//                              don't bleed into each other.
//   - most recently created  : good for "I just made this", bad afterwards.
//
// The placeholder below picks the first entry. Replace the bodies of
// pickInitialOrg / pickInitialSpace to set the policy; rememberScope is
// called whenever the user switches, so a "last used" policy has what it
// needs in localStorage under `ferrous-scope:<userId>`.
import { UmSpace, UmTenant } from "../core/umApi";

interface Remembered {
  orgId?: string;
  spaceId?: string;
}

const key = (userId: string) => `ferrous-scope:${userId}`;

export function readRemembered(userId: string): Remembered {
  try {
    const raw = localStorage.getItem(key(userId));
    return raw ? (JSON.parse(raw) as Remembered) : {};
  } catch {
    return {};
  }
}

export function rememberScope(userId: string, next: Remembered): void {
  try {
    localStorage.setItem(key(userId), JSON.stringify({ ...readRemembered(userId), ...next }));
  } catch {
    // Storage unavailable; selection just won't persist across reloads.
  }
}

/** TODO(policy): choose the organisation to open. Placeholder = first. */
export function pickInitialOrg(orgs: UmTenant[], _remembered: Remembered): UmTenant | null {
  return orgs[0] ?? null;
}

/** TODO(policy): choose the workspace within that organisation. Placeholder = first. */
export function pickInitialSpace(spaces: UmSpace[], _remembered: Remembered): UmSpace | null {
  return spaces[0] ?? null;
}
