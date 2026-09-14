// Activity-feed helpers, ported from the reference app's static/js/activity.js.
// Studio events carry entity_type/entity_id and a server-written `detail`
// (see eventsApi.ts); the entity's human id and the actor's name are looked
// up by the caller, so this stays a pure module.
import type { BoardEvent } from "./eventsApi";

export function relTime(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "";
  const t = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`).getTime();
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  if (s < 86400 * 14) return Math.floor(s / 86400) + "d ago";
  return iso.slice(0, 10);
}

export type EventVerb = "created" | "updated" | "deleted" | "shipped" | "unshipped" | "commented" | "uploaded" | "other";

export function eventVerb(action: string): EventVerb {
  if (action === "comment.created" || action === "commented") return "commented";
  const verb = action.includes(".") ? action.split(".")[1] : action;
  if (
    verb === "created" ||
    verb === "updated" ||
    verb === "deleted" ||
    verb === "shipped" ||
    verb === "unshipped" ||
    verb === "uploaded"
  ) {
    return verb;
  }
  return "other";
}

export const EV_GLYPH: Record<EventVerb, string> = {
  created: "＋",
  updated: "✎",
  deleted: "🗑",
  shipped: "🚀",
  unshipped: "↶",
  commented: "💬",
  uploaded: "📎",
  other: "·",
};

const isChange = (v: unknown): v is { from?: unknown; to?: unknown } =>
  !!v && typeof v === "object" && ("from" in (v as object) || "to" in (v as object));

const show = (v: unknown, resolve?: (v: unknown) => string | null): string => {
  if (v == null || v === "") return "—";
  const r = resolve?.(v);
  if (r) return r;
  return typeof v === "string" ? v : JSON.stringify(v);
};

// "created epic — Bulk import", "updated requirement — status: Todo → Doing".
// `resolveValue` lets the caller turn a uuid in a diff into a human id.
export function evSummary(e: BoardEvent, resolveValue?: (field: string, v: unknown) => string | null): string {
  const d = e.detail ?? {};
  const kind = e.entity_type;
  const verb = eventVerb(e.action);
  const name = String(d.title ?? d.name ?? d.text ?? d.excerpt ?? "");
  if (verb === "created") return `created ${kind}${name ? ` — ${name}` : ""}`;
  if (verb === "deleted") return `deleted ${kind}${name ? ` — ${name}` : ""}`;
  if (verb === "commented") return `commented${d.excerpt ? `: ${String(d.excerpt)}` : ""}`;
  if (verb === "shipped") return `shipped ${kind}${name ? ` — ${name}` : ""}`;
  if (verb === "unshipped") return `un-shipped ${kind}${name ? ` — ${name}` : ""}`;
  if (verb === "uploaded") return `attached ${d.filename ? String(d.filename) : "a file"}`;
  if (verb === "updated") {
    const parts = Object.entries(d)
      .filter(([, v]) => isChange(v))
      .map(([k, v]) => {
        const c = v as { from?: unknown; to?: unknown };
        const res = (x: unknown) => resolveValue?.(k, x) ?? null;
        return `${k.replace(/_id$/, "")}: ${show(c.from, res)} → ${show(c.to, res)}`;
      });
    return `updated ${kind}${parts.length ? ` — ${parts.join(" · ")}` : ""}`;
  }
  return e.action;
}
