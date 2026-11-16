// The page registry: one entry per page of every wireframe in the brief, keyed
// by the wireframe's own page id so a link in the brief (`props.links` →
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

export interface WireframeEntry {
  /** The wireframe id (`wireframeId` in the brief). */
  id: string;
  /** `wireframeName`: what the wireframe switcher shows. */
  name: string;
  /** The page this wireframe opens on: its `landingPageId`. */
  landingPageId: string;
}

export interface PageEntry {
  /** The wireframe page id. */
  id: string;
  /** The wireframe the page came from: one of WIREFRAMES. */
  wireframeId: string;
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

/** The brief's wireframes, in the brief's order. With more than one, the
 *  prototype shows a switcher between them (lib/WireframeSwitcher.tsx). */
export const WIREFRAMES: WireframeEntry[] = [
  { id: "wf-management", name: "Management app", landingPageId: "page-dashboard" },
];

const WF = "wf-management";

export const PAGES: PageEntry[] = [
  { id: "page-shell", wireframeId: WF, path: "/", title: "Shell", component: ShellPage },
  { id: "page-dashboard", wireframeId: WF, path: "", title: "Dashboard", component: DashboardPage, parentId: "page-shell" },
  { id: "page-orders", wireframeId: WF, path: "orders", title: "Orders", component: OrdersPage, parentId: "page-shell" },
  { id: "page-order", wireframeId: WF, path: "/order", title: "Order", component: OrderDrawer, presentation: "drawer" },
];

/** Where the prototype opens: the first wireframe's landing page. */
export const LANDING_PAGE_ID = WIREFRAMES[0].landingPageId;
