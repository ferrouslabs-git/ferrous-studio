// The Roadmap's release status filter (FS-REQ-95). A release that is live is
// finished business, so it is hidden until asked for; every other status
// shows. An empty selection means "every status", as in any MultiSelect.
import { DELIVERY_STATUS_LABEL } from "../board/constants";
import type { MultiSelectOption } from "../board/MultiSelect";
import type { DeliveryStatus } from "../board/sprintsApi";

// Read off the labels, in their order: sprintsApi itself loads the API
// client, which a plain test of this module should not need.
const DELIVERY_STATUSES = Object.keys(DELIVERY_STATUS_LABEL) as DeliveryStatus[];

export const DEFAULT_RELEASE_STATUSES: DeliveryStatus[] = DELIVERY_STATUSES.filter((s) => s !== "DeployedToLive");

export const RELEASE_STATUS_OPTIONS: MultiSelectOption[] = DELIVERY_STATUSES.map((s) => ({ value: s, label: DELIVERY_STATUS_LABEL[s] }));

/** The stored selection, with anything that is no longer a status dropped. */
export function releaseStatusSelection(stored: unknown): Set<string> {
  if (!Array.isArray(stored)) return new Set(DEFAULT_RELEASE_STATUSES);
  return new Set(stored.filter((s): s is string => (DELIVERY_STATUSES as string[]).includes(s)));
}

export function releasesWithStatus<T extends { status: string }>(releases: T[], selected: Set<string>): T[] {
  return selected.size === 0 ? releases : releases.filter((r) => selected.has(r.status));
}
