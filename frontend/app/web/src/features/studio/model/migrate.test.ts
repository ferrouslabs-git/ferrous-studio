import { describe, expect, it } from "vitest";
import { guessColumnKind, migrateComponent } from "./migrate";
import { ComponentNode, LinkTarget } from "./types";

const cmp = (type: string, props?: Record<string, unknown>): ComponentNode => ({
  id: "c1", type, label: "X", pos: "a0", ...(props ? { props } : {}),
});

const types = (c: ComponentNode) => c.elements?.map((e) => e.type) ?? [];
const labels = (c: ComponentNode) => c.elements?.map((e) => e.label) ?? [];
const linkOf = (c: ComponentNode, elementId: string): LinkTarget | undefined =>
  (c.props?.links as Record<string, LinkTarget> | undefined)?.[`el:${elementId}`];

describe("migrateComponent: nav family", () => {
  it("nav-cta becomes navbar plain/horizontal with brand, items, button and avatar", () => {
    const c = cmp("nav-cta", {
      brand: "Acme",
      items: ["Overview", "Users"],
      ctaText: "Get started",
      avatar: "AL",
      links: { items: [null, { pageId: "p1" }], ctaText: { pageId: "p2" } },
    });
    migrateComponent(c);
    expect(c.type).toBe("navbar");
    expect(c.shape).toBe("plain");
    expect(c.layout).toBe("horizontal");
    expect(types(c)).toEqual(["brand", "nav-item", "nav-item", "button", "avatar"]);
    const users = c.elements!.find((e) => e.label === "Users")!;
    const button = c.elements!.find((e) => e.type === "button")!;
    expect(linkOf(c, users.id)).toEqual({ pageId: "p1" });
    expect(linkOf(c, button.id)).toEqual({ pageId: "p2" });
    expect(c.props?.items).toBeUndefined();
  });

  it("sidenav-grouped becomes vertical grouped with heading + item elements", () => {
    const c = cmp("sidenav-grouped", {
      groups: [
        { title: "Main", items: ["Overview", "Reports"] },
        { title: "Admin", items: ["Users"] },
      ],
      links: { "groups.0.items": [null, { pageId: "p9" }] },
    });
    migrateComponent(c);
    expect(c.type).toBe("navbar");
    expect(c.shape).toBe("grouped");
    expect(c.layout).toBe("vertical");
    expect(labels(c)).toEqual(["Main", "Overview", "Reports", "Admin", "Users"]);
    const reports = c.elements!.find((e) => e.label === "Reports")!;
    expect(linkOf(c, reports.id)).toEqual({ pageId: "p9" });
  });

  it("tabs and breadcrumb become navbar shapes", () => {
    const t = cmp("tabs", { items: ["All", "Active"] });
    migrateComponent(t);
    expect([t.type, t.shape]).toEqual(["navbar", "tabs"]);
    const b = cmp("breadcrumb", { items: ["Home", "Detail"] });
    migrateComponent(b);
    expect([b.type, b.shape]).toEqual(["navbar", "breadcrumb"]);
  });

  it("renames the retired links shape on already-migrated navbars", () => {
    const horizontal: ComponentNode = { ...cmp("navbar"), shape: "links", layout: "horizontal", elements: [] };
    migrateComponent(horizontal);
    expect(horizontal.shape).toBe("plain");
    // Vertical rails drew icons under the old shape; keep the look.
    const vertical: ComponentNode = { ...cmp("navbar"), shape: "links", layout: "vertical", elements: [] };
    migrateComponent(vertical);
    expect(vertical.shape).toBe("icons");
    expect(vertical.elements).toEqual([]); // rename only — no re-migration
  });
});

describe("migrateComponent: list family", () => {
  it("list becomes table with kind-guessed columns and id-keyed rows", () => {
    const c = cmp("list", {
      columns: ["Name", "Email", "Status", "Joined"],
      rows: [
        ["Ada Lovelace", "ada@acme.io", "Active", "Mar 4, 2025"],
        ["Grace Hopper", "grace@acme.io", "Inactive", "Aug 22, 2023"],
      ],
      searchPlaceholder: "Search…",
    });
    migrateComponent(c);
    expect(c.shape).toBe("table");
    // The trailing header comes from the header migration (label fallback);
    // it sorts first by pos despite its array position.
    expect(types(c)).toEqual(["column-header", "column", "column", "column", "column", "search", "header"]);
    const cols = c.elements!.filter((e) => e.type === "column");
    expect(cols.map((e) => e.data!.kind)).toEqual(["text", "email", "status", "date"]);
    const rows = c.props!.rows as Record<string, string>[];
    expect(rows[0][cols[1].id]).toBe("ada@acme.io");
    expect(c.props!.columns).toBeUndefined();
  });

  it("rightpanel-activity becomes a feed list with real row values", () => {
    const c = cmp("rightpanel-activity", {
      items: ["Created record", "Updated status"],
      times: ["2 min ago", "1 hr ago"],
      avatars: ["AL", "GH"],
    });
    migrateComponent(c);
    expect(c.type).toBe("list");
    expect(c.shape).toBe("feed");
    const rows = c.props!.rows as Record<string, string>[];
    expect(Object.values(rows[0])).toEqual(["Created record", "AL", "2 min ago"]);
  });

  it("filters becomes a rows list of search + filter chips", () => {
    const c = cmp("filters", { items: ["Role", "Joined", "Clear"], searchPlaceholder: "Search…" });
    migrateComponent(c);
    expect(c.type).toBe("list");
    expect(c.shape).toBe("rows");
    expect(types(c)).toEqual(["search", "filter", "filter", "header"]);
  });
});

describe("migrateComponent: graph and form families", () => {
  it("chart becomes a bar graph with one series and a category axis", () => {
    const c = cmp("chart", { items: ["Jan", "Feb"], values: ["42", "58"], rangeText: "Last 12 months" });
    migrateComponent(c);
    expect(c.type).toBe("graph");
    expect(c.shape).toBe("bar");
    const series = c.elements!.find((e) => e.type === "series")!;
    expect(series.data!.values).toBe("42, 58");
    expect(c.elements!.find((e) => e.type === "category-axis")!.data!.categories).toBe("Jan, Feb");
  });

  it("kpi becomes stat tiles", () => {
    const c = cmp("kpi", { items: ["Users", "Churn"], values: ["12,408", "1.4%"], deltas: ["+4.2%", "−0.2%"] });
    migrateComponent(c);
    expect(c.shape).toBe("stats");
    expect(c.elements![1]).toMatchObject({ type: "stat", label: "Churn", data: { value: "1.4%", delta: "−0.2%" } });
  });

  it("form fields keep their kind heuristics; stepper and actions fold in", () => {
    const f = cmp("form", { items: ["Name", "Email", "Role"], cancelText: "Cancel", submitText: "Save" });
    migrateComponent(f);
    expect(types(f)).toEqual(["text-input", "text-input", "select", "button", "button", "header"]);
    expect(f.elements![1].data!.kind).toBe("email");
    const st = cmp("stepper", { items: ["Account", "Review"] });
    migrateComponent(st);
    expect([st.type, st.shape, types(st)[0]]).toEqual(["form", "wizard", "step"]);
    const a = cmp("actions", { items: ["Cancel", "Save changes"] });
    migrateComponent(a);
    expect([a.type, a.shape]).toEqual(["form", "inline"]);
    expect(a.elements![1].data!.style).toBe("primary");
  });
});

describe("migrateComponent: kept components", () => {
  it("detail keeps heading/status props and lifts items+values into fields", () => {
    const c = cmp("rightpanel-detail", {
      heading: "Ada Lovelace", status: "Active",
      items: ["Status", "Email"], values: ["Active", "ada@acme.io"], buttons: ["Edit", "Delete"],
    });
    migrateComponent(c);
    expect(c.type).toBe("detail");
    expect(c.props?.heading).toBe("Ada Lovelace");
    const fields = c.elements!.filter((e) => e.type === "field");
    expect(fields[1].data).toMatchObject({ value: "ada@acme.io", kind: "email" });
    expect(c.elements!.find((e) => e.label === "Delete")!.data!.style).toBe("danger");
  });

  it("hero, empty, main, modal and footer lift their props into elements", () => {
    const h = cmp("hero", { items: ["Title", "Subtitle", "Go"] });
    migrateComponent(h);
    expect(types(h)).toEqual(["heading", "text", "button"]);
    const m = cmp("main", { items: ["Summary"], bodies: ["Body."] });
    migrateComponent(m);
    expect(m.elements![0]).toMatchObject({ type: "section", label: "Summary", data: { body: "Body." } });
    const f = cmp("footer", { items: ["Privacy"], copyright: "© 2026 Acme" });
    migrateComponent(f);
    expect(types(f)).toEqual(["link"]);
    expect(f.props?.copyright).toBe("© 2026 Acme");
  });
});

describe("idempotence and safety", () => {
  it("migrating twice equals migrating once", () => {
    const c = cmp("nav-basic", { brand: "Acme", items: ["Overview"] });
    migrateComponent(c);
    const snapshot = JSON.parse(JSON.stringify(c));
    migrateComponent(c);
    expect(c).toEqual(snapshot);
  });

  it("leaves custom blocks and unknown types alone", () => {
    const c = cmp("editable-component");
    migrateComponent(c);
    expect(c.shape).toBeUndefined();
    const u = cmp("mystery-type", { items: ["x"] });
    migrateComponent(u);
    expect(u.elements).toBeUndefined();
  });

  it("mints defaults for a new-model type stored without shape", () => {
    const c = cmp("calendar");
    migrateComponent(c);
    expect(c.shape).toBe("month");
    expect(c.layout).toBe("full");
  });
});

describe("migrateComponent: header prop → element", () => {
  const modern = (type: string, shape: string, props?: Record<string, unknown>): ComponentNode => ({
    id: "c1", type, label: "X", pos: "a0", shape, elements: [], ...(props ? { props } : {}),
  });

  it("materialises a header element from props.title and carries its link", () => {
    const c = modern("list", "table", { title: "Team", links: { title: { pageId: "p1" } } });
    migrateComponent(c);
    const header = c.elements!.find((e) => e.type === "header")!;
    expect(header.label).toBe("Team");
    expect(header.data?.placement).toBe("inline");
    expect(linkOf(c, header.id)).toEqual({ pageId: "p1" });
    expect(c.props?.title).toBeUndefined();
    expect((c.props?.links as Record<string, unknown>).title).toBeUndefined();
  });

  it("falls back to the component label when no title was set", () => {
    const c = modern("graph", "bar");
    migrateComponent(c);
    expect(c.elements!.find((e) => e.type === "header")!.label).toBe("X");
  });

  it("sorts the materialised header before existing elements", () => {
    const c = modern("list", "table");
    c.elements = [{ id: "e1", type: "column", label: "Name", pos: "a0" }];
    migrateComponent(c);
    const header = c.elements.find((e) => e.type === "header")!;
    expect(header.pos < "a0").toBe(true);
  });

  it("honours the removal tombstone and never duplicates an existing header", () => {
    const removed = modern("form", "simple", { title: "" });
    migrateComponent(removed);
    expect(removed.elements!.some((e) => e.type === "header")).toBe(false);
    expect(removed.props?.title).toBe(""); // the tombstone survives the read

    const existing = modern("calendar", "month", { title: "Stale" });
    existing.elements = [{ id: "e1", type: "header", label: "Kept", pos: "a0" }];
    migrateComponent(existing);
    expect(existing.elements.filter((e) => e.type === "header")).toHaveLength(1);
    expect(existing.elements[0].label).toBe("Kept");
    expect(existing.props?.title).toBeUndefined();
  });

  it("leaves non-host types alone", () => {
    const c = modern("navbar", "plain", { title: "Stray" });
    migrateComponent(c);
    expect(c.elements).toEqual([]);
    expect(c.props?.title).toBe("Stray");
  });
});

describe("guessColumnKind", () => {
  it("is conservative: text unless header or all samples agree", () => {
    expect(guessColumnKind("Email", [])).toBe("email");
    expect(guessColumnKind("Joined", [])).toBe("date");
    expect(guessColumnKind("Anything", ["Active", "Inactive"])).toBe("status");
    expect(guessColumnKind("Total", ["£84.3k", "£12"])).toBe("currency");
    expect(guessColumnKind("Name", ["Ada Lovelace"])).toBe("text");
    expect(guessColumnKind("Count", ["42", "x1"])).toBe("text");
  });
});
