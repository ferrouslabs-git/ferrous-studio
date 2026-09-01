// Read-time migration of pre-restructure components to the Components +
// Elements model. Runs inside normalizePage on an immer draft; idempotent —
// a component with a `shape` is already migrated and is left alone. Nothing
// is persisted here: the converted form reaches the server lazily, the next
// time the user edits that component (the diff then emits whole-key sets).
//
// The fold (user decision): tabs & breadcrumb → nav bar shapes; stepper &
// action rows → form; KPI row → graph stat tiles; filters & activity feed →
// list; the sidenavs → nav bar layout "vertical". Hero, detail, empty, main,
// modal and footer stay as components with small element vocabularies.
import { COMPONENTS, ElementSeed } from "../catalog";
import type { LinksProp } from "./actions";
import { reposition } from "./positions";
import { makeElement } from "./regions";
import { ComponentNode, ElementNode, LinkTarget } from "./types";

const s = (v: unknown, fallback = ""): string => (v == null ? fallback : String(v));
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => (x == null ? "" : String(x))) : []);

/** Column-kind guessing for migrated lists. Conservative: `text` unless the
 *  header or every sample clearly says otherwise. */
export function guessColumnKind(header: string, samples: string[]): string {
  const h = header.trim().toLowerCase();
  const filled = samples.map((v) => v.trim()).filter(Boolean);
  const every = (re: RegExp) => filled.length > 0 && filled.every((v) => re.test(v));
  if (/e-?mail/.test(h) || every(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) return "email";
  if (/^(status|state)$/.test(h) || every(/^(active|inactive|pending|invited|disabled|enabled|archived)$/i)) return "status";
  if (/date|joined|created|updated|birth/.test(h) || every(/^\d{1,2} \w{3} \d{4}$|^\w{3} \d{1,2}, \d{4}$|^\d{4}-\d{2}-\d{2}$/)) return "date";
  if (/time|when/.test(h) || every(/\b(ago|am|pm)\b|^\d{1,2}:\d{2}/i)) return "time";
  if (every(/^[£$€]/)) return "currency";
  if (every(/^-?[\d,.]+%$/)) return "percentage";
  if (filled.length > 0 && every(/^-?[\d,.]+$/)) return "number";
  return "text";
}

/** Form-field kind guessing, ported from the old renderer's heuristics. */
function fieldSeed(label: string): ElementSeed {
  const k = label.toLowerCase();
  if (/e-?mail/.test(k)) return { type: "text-input", label, data: { kind: "email" } };
  if (/note|desc|bio|comment|message|summary/.test(k)) return { type: "text-area", label };
  if (/avatar|image|photo|logo|file|upload|attachment/.test(k)) return { type: "file-upload", label };
  if (/role|team|status|type|plan|country|region|category|owner|assign|department/.test(k)) return { type: "select", label };
  return { type: "text-input", label };
}

interface Ctx {
  cmp: ComponentNode;
  props: Record<string, unknown>;
  oldLinks: LinksProp;
  newLinks: Record<string, LinkTarget>;
  elements: ElementNode[];
}

/** Append one element (dropping seeds the new vocabulary rejects) and carry
 *  a legacy link across to the element's `el:` key. */
function put(ctx: Ctx, seed: ElementSeed, link?: LinkTarget | null): ElementNode | null {
  const node = makeElement(ctx.cmp.type, seed);
  if (!node) return null;
  ctx.elements.push(node);
  if (link) ctx.newLinks[`el:${node.id}`] = link;
  return node;
}

const linkAt = (ctx: Ctx, key: string, index: number): LinkTarget | null => {
  const entry = ctx.oldLinks[key];
  return Array.isArray(entry) ? (entry[index] ?? null) : null;
};
const scalarLink = (ctx: Ctx, key: string): LinkTarget | null => {
  const entry = ctx.oldLinks[key];
  return entry && !Array.isArray(entry) ? entry : null;
};

/** items[] → one element per entry via `seedFor`, links carried by index. */
function putItems(ctx: Ctx, key: string, items: string[], seedFor: (label: string, i: number) => ElementSeed): void {
  items.forEach((label, i) => {
    if (label) put(ctx, seedFor(label, i), linkAt(ctx, key, i));
  });
}

function navChrome(ctx: Ctx): void {
  if (ctx.props.searchPlaceholder != null) put(ctx, { type: "search", label: s(ctx.props.searchPlaceholder, "Search…") });
  if (ctx.props.ctaText != null) put(ctx, { type: "button", label: s(ctx.props.ctaText, "Get started") }, scalarLink(ctx, "ctaText"));
  if (ctx.props.avatar != null || ctx.props.userName != null) {
    put(ctx, {
      type: "avatar",
      label: s(ctx.props.avatar, "AL"),
      data: { name: s(ctx.props.userName, "Ada Lovelace"), role: s(ctx.props.userRole, "Administrator") },
    });
  }
}

const asNavbar = (shape: string, layout: string) => (ctx: Ctx) => {
  ctx.cmp.type = "navbar";
  ctx.cmp.shape = shape;
  ctx.cmp.layout = layout;
  if (ctx.props.brand != null) put(ctx, { type: "brand", label: s(ctx.props.brand, "Acme") }, scalarLink(ctx, "brand"));
  if (ctx.props.workspace != null) put(ctx, { type: "workspace-switcher", label: s(ctx.props.workspace) });
  if (layout === "vertical" && ctx.props.sectionTitle != null) put(ctx, { type: "group-heading", label: s(ctx.props.sectionTitle) });
  const groups = ctx.props.groups;
  if (Array.isArray(groups)) {
    ctx.cmp.shape = "grouped";
    groups.forEach((g, gi) => {
      const group = g as { title?: string; items?: unknown };
      if (group.title) put(ctx, { type: "group-heading", label: s(group.title) });
      arr(group.items).forEach((label, i) => {
        if (label) put(ctx, { type: "nav-item", label }, linkAt(ctx, `groups.${gi}.items`, i));
      });
    });
  }
  putItems(ctx, "items", arr(ctx.props.items), (label) => ({ type: "nav-item", label }));
  navChrome(ctx);
  consume(ctx, ["brand", "items", "groups", "searchPlaceholder", "ctaText", "avatar", "userName", "userRole", "sectionTitle", "workspaceTitle", "workspace", "accountTitle"]);
};

function consume(ctx: Ctx, keys: string[]): void {
  for (const key of keys) delete ctx.props[key];
}

const asForm = (shape: string) => (ctx: Ctx) => {
  ctx.cmp.type = "form";
  ctx.cmp.shape = shape;
  // Old forms rendered two columns; keep the look after migration.
  ctx.cmp.layout = shape === "simple" ? "two-column" : "one-column";
  const items = arr(ctx.props.items);
  if (ctx.cmp.type === "form" && shape === "wizard") putItems(ctx, "items", items, (label) => ({ type: "step", label }));
  else if (shape === "inline") putItems(ctx, "items", items, (label, i) => ({ type: "button", label, data: { style: i === items.length - 1 ? "primary" : "secondary" } }));
  else putItems(ctx, "items", items, (label) => fieldSeed(label));
  if (ctx.props.cancelText != null) put(ctx, { type: "button", label: s(ctx.props.cancelText, "Cancel"), data: { style: "secondary" } }, scalarLink(ctx, "cancelText"));
  if (ctx.props.submitText != null) put(ctx, { type: "button", label: s(ctx.props.submitText, "Save"), data: { style: "primary" } }, scalarLink(ctx, "submitText"));
  consume(ctx, ["items", "cancelText", "submitText"]);
};

/** Legacy filter panel: selects + buttons, closest to a simple form. */
function asFilterPanel(ctx: Ctx): void {
  ctx.cmp.type = "form";
  ctx.cmp.shape = "simple";
  ctx.cmp.layout = "one-column";
  putItems(ctx, "items", arr(ctx.props.items), (label) => ({ type: "select", label, data: { options: `Any ${label.toLowerCase()}` } }));
  const buttons = arr(ctx.props.buttons);
  buttons.forEach((label, i) => {
    if (label) put(ctx, { type: "button", label, data: { style: i === buttons.length - 1 ? "primary" : "secondary" } }, linkAt(ctx, "buttons", i));
  });
  consume(ctx, ["items", "buttons", "resetText"]);
}

const MIGRATIONS: Record<string, (ctx: Ctx) => void> = {
  navbar: asNavbar("links", "horizontal"),
  "nav-basic": asNavbar("links", "horizontal"),
  "nav-search": asNavbar("links", "horizontal"),
  "nav-cta": asNavbar("links", "horizontal"),
  sidebar: asNavbar("links", "vertical"),
  "sidenav-simple": asNavbar("links", "vertical"),
  "sidenav-grouped": asNavbar("grouped", "vertical"),
  "sidenav-workspace": asNavbar("links", "vertical"),
  tabs: asNavbar("tabs", "horizontal"),
  breadcrumb: asNavbar("breadcrumb", "horizontal"),

  list(ctx) {
    ctx.cmp.shape = "table";
    ctx.cmp.layout = "vertical";
    const columns = arr(ctx.props.columns);
    const oldRows = Array.isArray(ctx.props.rows) ? (ctx.props.rows as unknown[][]) : [];
    put(ctx, { type: "column-header" });
    const colIds: (string | null)[] = columns.map((header, ci) => {
      const samples = oldRows.map((row) => s(Array.isArray(row) ? row[ci] : ""));
      const node = put(ctx, { type: "column", label: header || `Column ${ci + 1}`, data: { kind: guessColumnKind(header, samples) } });
      return node?.id ?? null;
    });
    ctx.props.rows = oldRows.map((row) => {
      const record: Record<string, string> = {};
      colIds.forEach((id, ci) => {
        const v = s(Array.isArray(row) ? row[ci] : "");
        if (id && v) record[id] = v;
      });
      return record;
    });
    if (ctx.props.searchPlaceholder != null) put(ctx, { type: "search", label: s(ctx.props.searchPlaceholder, "Search…") });
    consume(ctx, ["columns", "searchPlaceholder"]);
  },

  filters(ctx) {
    ctx.cmp.type = "list";
    ctx.cmp.shape = "rows";
    ctx.cmp.layout = "vertical";
    if (ctx.props.searchPlaceholder != null) put(ctx, { type: "search", label: s(ctx.props.searchPlaceholder, "Search…") });
    putItems(ctx, "items", arr(ctx.props.items).filter((v) => !/^(clear|reset)$/i.test(v.trim())), (label) => ({ type: "filter", label }));
    delete ctx.props.rows;
    consume(ctx, ["items", "searchPlaceholder"]);
  },

  "rightpanel-activity"(ctx) {
    ctx.cmp.type = "list";
    ctx.cmp.shape = "feed";
    ctx.cmp.layout = "vertical";
    const events = arr(ctx.props.items);
    const times = arr(ctx.props.times);
    const people = arr(ctx.props.avatars);
    const eventCol = put(ctx, { type: "column", label: "Event", data: { kind: "text" } });
    const personCol = people.length ? put(ctx, { type: "column", label: "Who", data: { kind: "person" } }) : null;
    const whenCol = put(ctx, { type: "column", label: "When", data: { kind: "time" } });
    ctx.props.rows = events.map((event, i) => {
      const record: Record<string, string> = {};
      if (eventCol && event) record[eventCol.id] = event;
      if (personCol && people[i]) record[personCol.id] = people[i];
      if (whenCol && times[i]) record[whenCol.id] = times[i];
      return record;
    });
    consume(ctx, ["items", "times", "avatars"]);
  },

  chart(ctx) {
    ctx.cmp.type = "graph";
    ctx.cmp.shape = "bar";
    ctx.cmp.layout = "vertical";
    const categories = arr(ctx.props.items);
    const values = arr(ctx.props.values);
    put(ctx, { type: "series", label: "Series", data: { values: values.join(", ") } });
    if (categories.length) put(ctx, { type: "category-axis", data: { categories: categories.join(", ") } });
    if (ctx.props.rangeText != null) put(ctx, { type: "range-selector", label: s(ctx.props.rangeText, "Last 12 months") });
    consume(ctx, ["items", "values", "rangeText"]);
  },

  kpi(ctx) {
    ctx.cmp.type = "graph";
    ctx.cmp.shape = "stats";
    ctx.cmp.layout = "vertical";
    const values = arr(ctx.props.values);
    const deltas = arr(ctx.props.deltas);
    putItems(ctx, "items", arr(ctx.props.items), (label, i) => ({
      type: "stat",
      label,
      data: { value: values[i] ?? "", delta: deltas[i] ?? "" },
    }));
    consume(ctx, ["items", "values", "deltas"]);
  },

  form: asForm("simple"),
  stepper: asForm("wizard"),
  actions: asForm("inline"),
  "rightpanel-filters": asFilterPanel,

  detail(ctx) {
    ctx.cmp.shape = "panel";
    const values = arr(ctx.props.values);
    putItems(ctx, "items", arr(ctx.props.items), (label, i) => ({
      type: "field",
      label,
      data: { value: values[i] ?? "—", kind: guessColumnKind(label, values[i] ? [values[i]] : []) },
    }));
    const buttons = arr(ctx.props.buttons);
    buttons.forEach((label, i) => {
      if (label) put(ctx, { type: "button", label, data: { style: /delete|remove/i.test(label) ? "danger" : "secondary" } }, linkAt(ctx, "buttons", i));
    });
    consume(ctx, ["items", "values", "buttons"]);
  },

  hero(ctx) {
    ctx.cmp.shape = "centred";
    const items = arr(ctx.props.items);
    items.forEach((label, i) => {
      if (!label) return;
      const seed: ElementSeed =
        i === 0 ? { type: "heading", label } : i === 1 ? { type: "text", label } : { type: "button", label, data: { style: i === 2 ? "primary" : "secondary" } };
      put(ctx, seed, linkAt(ctx, "items", i));
    });
    consume(ctx, ["items"]);
  },

  empty(ctx) {
    ctx.cmp.shape = "default";
    const items = arr(ctx.props.items);
    if (items[0]) put(ctx, { type: "heading", label: items[0] }, linkAt(ctx, "items", 0));
    if (ctx.props.description != null) put(ctx, { type: "text", label: s(ctx.props.description) });
    items.slice(1).forEach((label, j) => {
      if (label) put(ctx, { type: "button", label, data: { style: j === 0 ? "primary" : "secondary" } }, linkAt(ctx, "items", j + 1));
    });
    consume(ctx, ["items", "description"]);
  },

  main(ctx) {
    ctx.cmp.shape = "default";
    const bodies = arr(ctx.props.bodies);
    putItems(ctx, "items", arr(ctx.props.items), (label, i) => ({ type: "section", label, data: { body: bodies[i] ?? "" } }));
    consume(ctx, ["items", "bodies"]);
  },

  modal(ctx) {
    ctx.cmp.shape = "default";
    if (ctx.props.body != null) put(ctx, { type: "text", label: s(ctx.props.body) });
    const items = arr(ctx.props.items);
    items.forEach((label, i) => {
      if (label) put(ctx, { type: "button", label, data: { style: i === items.length - 1 ? "primary" : "secondary" } }, linkAt(ctx, "items", i));
    });
    consume(ctx, ["items", "body"]);
  },

  footer(ctx) {
    ctx.cmp.shape = "default";
    putItems(ctx, "items", arr(ctx.props.items), (label) => ({ type: "link", label }));
    consume(ctx, ["items"]);
  },

  "rightpanel-detail"(ctx) {
    ctx.cmp.type = "detail";
    MIGRATIONS.detail(ctx);
  },
};

/** Convert one component in place. Safe to call on anything: already-migrated
 *  components (shape set), custom blocks and unknown types are left alone. */
export function migrateComponent(cmp: ComponentNode): void {
  if (cmp.shape !== undefined) return;
  const migrate = MIGRATIONS[cmp.type];
  const meta = COMPONENTS[cmp.type];
  if (!migrate && !meta) return;

  const props = (cmp.props ??= {});
  const oldLinks = (props.links as LinksProp | undefined) ?? {};
  const ctx: Ctx = { cmp, props, oldLinks, newLinks: {}, elements: [] };

  if (migrate) migrate(ctx);
  else {
    // A new-model type stored without shape: mint the defaults.
    cmp.shape = meta!.defaultShape;
    if (meta!.defaultLayout) cmp.layout = meta!.defaultLayout;
  }
  if (COMPONENTS[cmp.type] && !cmp.layout && COMPONENTS[cmp.type].defaultLayout) {
    cmp.layout = COMPONENTS[cmp.type].defaultLayout;
  }

  if (ctx.elements.length) {
    reposition(ctx.elements);
    cmp.elements = ctx.elements;
  }
  // Only scalar link targets survive on prop keys; index-aligned arrays were
  // re-keyed to `el:` addresses above.
  const survivors: Record<string, LinkTarget> = { ...ctx.newLinks };
  for (const [key, entry] of Object.entries(oldLinks)) {
    if (entry && !Array.isArray(entry) && key in props) survivors[key] = entry;
  }
  if (Object.keys(survivors).length) props.links = survivors;
  else delete props.links;
  if (!Object.keys(props).length) delete cmp.props;
}
