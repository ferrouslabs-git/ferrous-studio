// The page registry: one entry per page of the wireframe, keyed by the
// wireframe's own page id so a link in the brief (`props.links` →
// `{ pageId }`) resolves by lookup rather than by guesswork.
//
// Replace the example entries with the wireframe's pages. See
// references/wireframe-to-prototype.md for how each field is derived.
import type { ComponentType } from "react";
import { DashboardPage } from "./pages/DashboardPage";
import { OrderDrawer } from "./pages/OrderDrawer";
import { OrdersPage } from "./pages/OrdersPage";
import { ShellPage } from "./pages/ShellPage";

export type Presentation = "modal" | "drawer" | "drawer-left";

export interface PageEntry {
  /** The wireframe page id. */
  id: string;
  /** Hash route, without the leading #. A placed page's path is relative to
   *  its parent's. */
  path: string;
  title: string;
  component: ComponentType;
  /** Set when the wireframe page has a `placement`: the id of the page whose
   *  region it renders in. That parent must render an <Outlet /> there. */
  parentId?: string;
  /** Set when the wireframe page has a `presentation`: it opens over the
   *  page it was linked from instead of replacing it. */
  presentation?: Presentation;
}

export const PAGES: PageEntry[] = [
  { id: "page-shell", path: "/", title: "Shell", component: ShellPage },
  { id: "page-dashboard", path: "", title: "Dashboard", component: DashboardPage, parentId: "page-shell" },
  { id: "page-orders", path: "orders", title: "Orders", component: OrdersPage, parentId: "page-shell" },
  { id: "page-order", path: "/order", title: "Order", component: OrderDrawer, presentation: "drawer" },
];

/** The wireframe's `landingPageId`: where the prototype opens. */
export const LANDING_PAGE_ID = "page-dashboard";
