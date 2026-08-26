// Region rules and per-type default props. Ported from legacy/js/state.js.
// Pure functions: no state, no DOM. This is the domain knowledge the server
// deliberately does not have.
import { COMPONENT_TYPES, DEFAULT_LABELS } from "../catalog";
import { ComponentNode, RegionName, REGION_ORDER } from "./types";

/** Which region a component type belongs in when auto-classified. */
export const REGION_RULES: Record<string, RegionName> = {
  navbar: "header",
  breadcrumb: "header",
  tabs: "header",
  "nav-basic": "header",
  "nav-search": "header",
  "nav-cta": "header",
  sidebar: "sidebar",
  "sidenav-simple": "sidebar",
  "sidenav-grouped": "sidebar",
  "sidenav-workspace": "sidebar",
  detail: "right",
  "rightpanel-detail": "right",
  "rightpanel-filters": "right",
  "rightpanel-activity": "right",
  footer: "footer",
};

/** Shell chrome: types that own a region rather than stack inside one. */
export const STRUCTURAL_TYPES = new Set<string>([
  "navbar", "sidebar", "detail", "footer", "tabs", "breadcrumb", "main",
  "nav-basic", "nav-search", "nav-cta",
  "sidenav-simple", "sidenav-grouped", "sidenav-workspace",
  "rightpanel-detail", "rightpanel-filters", "rightpanel-activity",
]);

export const classifyRegion = (type: string): RegionName => REGION_RULES[type] ?? "main";

export function emptyRegions(): Record<RegionName, ComponentNode[]> {
  return { header: [], sidebar: [], main: [], right: [], footer: [] };
}

export const REGION_LABEL: Record<RegionName, string> = {
  header: "header",
  sidebar: "sidebar",
  main: "main",
  right: "right",
  footer: "footer",
};

export { REGION_ORDER };

/** Short random ids. More entropy than the legacy counter-based uid, since
 *  ids now live in a shared database rather than one browser session. */
export function uid(prefix: string): string {
  const bytes = new Uint8Array(6);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return `${prefix}-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** Placeholder content for a freshly added component, by type. */
export function getDefaultProps(type: string): Record<string, unknown> {
  switch (type) {
    case "navbar":
    case "nav-basic":
    case "nav-search":
      return { items: ["Overview", "Users", "Reports"] };
    case "nav-cta":
      return { items: ["Overview", "Users"], ctaText: "Get started" };
    case "sidebar":
    case "sidenav-simple":
      return { sectionTitle: "Navigation", workspaceTitle: "Workspace", items: ["Overview", "Users", "Reports", "Settings"] };
    case "sidenav-grouped":
      return {
        groups: [
          { title: "Main", items: ["Overview", "Reports"] },
          { title: "Admin", items: ["Users", "Billing"] },
        ],
      };
    case "sidenav-workspace":
      return { sectionTitle: "Workspace", workspace: "Acme Workspace", items: ["Dashboard", "Members", "Projects", "Settings"] };
    case "tabs":
      return { items: ["All", "Active", "Invited", "Disabled"] };
    case "breadcrumb":
      return { items: ["Home", "Section", "Detail"] };
    case "footer":
      return { items: ["Privacy", "Terms", "Support"] };
    case "hero":
      return { items: ["Title", "Subtitle", "Get started"] };
    case "kpi":
      return { items: ["Users", "Active", "Revenue", "Churn"] };
    case "list":
      return {
        columns: ["Name", "Email", "Status", "Joined"],
        rows: [
          ["Ada Lovelace", "ada@acme.io", "Active", "Mar 4, 2025"],
          ["Linus Torvalds", "linus@acme.io", "Active", "Jan 12, 2024"],
          ["Grace Hopper", "grace@acme.io", "Inactive", "Aug 22, 2023"],
        ],
      };
    case "chart":
      return { items: ["Jan", "Feb", "Mar", "Apr"] };
    case "detail":
    case "rightpanel-detail":
      return { items: ["Status", "Email", "Role", "Joined"] };
    case "rightpanel-filters":
      return { items: ["Status", "Date range", "Assigned to"] };
    case "rightpanel-activity":
      return { items: ["Created record", "Updated status", "Added note"] };
    case "empty":
      return { items: ["Nothing here yet", "Create record"] };
    case "main":
      return { items: ["Summary", "Highlights", "Notes"] };
    case "form":
      return { items: ["Name", "Email", "Role", "Team"] };
    case "filters":
      return { items: ["Role", "Joined", "Clear"] };
    case "editable-component":
      return {};
    case "stepper":
      return { items: ["Account", "Profile", "Team", "Review"] };
    case "modal":
      return { items: ["Cancel", "Confirm"] };
    case "actions":
      return { items: ["Cancel", "Save changes"] };
    default: {
      // Extensibility contract: a type may declare defaultProps in the
      // catalogue; otherwise it gets a single editable item from its label.
      const meta = COMPONENT_TYPES[type];
      if (meta?.defaultProps) return JSON.parse(JSON.stringify(meta.defaultProps));
      if (type === "custom") return {};
      const label = DEFAULT_LABELS[type] ?? meta?.label ?? type;
      return label ? { items: [label] } : {};
    }
  }
}
