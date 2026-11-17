// A shell page: the wireframe page whose layout is a split with a nav region
// and a content region other pages are placed into. The placed page renders
// where the <Outlet /> is.
import { NavLink, Outlet } from "react-router-dom";
import { pathOf } from "../lib/nav";

export function ShellPage() {
  return (
    <div className="shell">
      <nav className="shell-nav" aria-label="Primary">
        <div className="brand">Brand</div>
        <NavLink to={pathOf("page-dashboard")} end>
          Dashboard
        </NavLink>
        <NavLink to={pathOf("page-orders")}>Orders</NavLink>
      </nav>
      <main className="shell-content">
        <Outlet />
      </main>
    </div>
  );
}
