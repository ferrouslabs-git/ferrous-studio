// Persistent chrome for signed-in screens: a left sidebar with the brand, the
// organisation switcher, grouped section links and the user footer, plus the
// routed page beside it. Collapses to a top strip on narrow viewports.
//
// Inside a project (/orgs/:orgId/projects/:projectId/...) the project's own
// menu replaces the organisation and administration groups; a single "Back to
// organisation" link is the way out.
import { ReactNode, useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useMatch, useNavigate } from "react-router-dom";
import { authService } from "../core/auth";
import { useSession } from "./session";
import { EditOrgButton } from "../features/orgs/EditOrgButton";
import { ShellProject, ShellProjectContext } from "./shellProject";
import { ThemeToggle } from "../components/ThemeToggle";
import { useLoad } from "../core/useLoad";
import { listProjectVersions } from "../features/projects/projectsApi";

export function AppShell() {
  const { user, orgs, activeOrg, selectOrg, refresh } = useSession();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [shellProject, setShellProject] = useState<ShellProject | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const projectMatch = useMatch("/orgs/:orgId/projects/:projectId/*");

  // Close the mobile drawer on navigation.
  useEffect(() => setMobileOpen(false), [location.pathname]);

  // The collapsed choice survives reloads and new tabs.
  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
      /* storage unavailable (private mode); the choice just won't persist */
    }
  }, [collapsed]);

  // Switching organisation while on an organisation-scoped page keeps the
  // same page but for the new organisation; elsewhere only the active scope
  // changes.
  const switchOrg = async (orgId: string) => {
    await selectOrg(orgId);
    const m = location.pathname.match(/^\/orgs\/[^/]+(\/.*)?$/);
    if (m) navigate(`/orgs/${orgId}${m[1] ?? ""}`);
  };

  const isAdmin = !!user?.is_platform_admin;
  const initials = (user?.name || user?.email || "?").slice(0, 1).toUpperCase();
  // Platform admins belong to no organisation: their menu is the platform one
  // and only that, even while they are looking at an organisation's own pages.
  // Everything an organisation's menu offers (its projects, its users, editing
  // it) they reach through Administration instead.
  const inProjectScope = !!projectMatch;
  const showOrgNav = !!activeOrg && !inProjectScope && !isAdmin;
  const canEditOrg = activeOrg?.role === "account_admin";

  return (
    <div
      className={`shell${mobileOpen ? " is-mobile-open" : ""}${collapsed ? " is-collapsed" : ""}`}
    >
      <aside className="sidebar" aria-label="Main navigation">
        <button
          type="button"
          className="sidebar-rail"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? "Expand navigation" : "Collapse navigation"}
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          aria-expanded={!collapsed}
        >
          <span className="sidebar-rail-grip" aria-hidden="true">
            {collapsed ? "›" : "‹"}
          </span>
        </button>
        <div className="sidebar-top">
          <Link to={isAdmin ? "/admin/orgs" : activeOrg ? `/orgs/${activeOrg.id}/projects` : "/orgs"} className="sidebar-brand" title="Ferrous Studio">
            <span className="sidebar-logo" aria-hidden="true">
              <span className="brand-symbol" />
            </span>
            <span className="sidebar-label">
              Ferrous Studio
              {isAdmin && <span className="sidebar-eyebrow">Platform admin</span>}
            </span>
          </Link>
          <button
            className="sidebar-burger"
            onClick={() => setMobileOpen((o) => !o)}
            aria-label="Toggle navigation"
            aria-expanded={mobileOpen}
          >
            <Icon name="menu" />
          </button>
        </div>

        <div className="sidebar-scroll">
          {inProjectScope && projectMatch && (
            <ProjectNav
              orgId={projectMatch.params.orgId ?? ""}
              projectId={projectMatch.params.projectId ?? ""}
              name={shellProject?.name ?? "Project"}
              isAdmin={isAdmin}
            />
          )}

          {showOrgNav && (
            <div className="sidebar-scope">
              <label className="sidebar-field">
                <span className="sidebar-label sidebar-field-name">Organisation</span>
                {orgs.length > 1 ? (
                  <select
                    className="select"
                    aria-label="Organisation"
                    value={activeOrg?.id ?? ""}
                    onChange={(e) => void switchOrg(e.target.value)}
                  >
                    {orgs.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="sidebar-scope-value sidebar-label">{activeOrg?.name}</span>
                )}
              </label>
              {activeOrg && canEditOrg && (
                <span className="sidebar-scope-edit">
                  <EditOrgButton org={activeOrg} onSaved={refresh} />
                </span>
              )}
            </div>
          )}

          {showOrgNav && activeOrg && (
            <NavGroup>
              <NavItem to={`/orgs/${activeOrg.id}/projects`} icon="folder" label="Projects" />
              <NavItem to={`/orgs/${activeOrg.id}/users`} icon="users" label="Users" />
            </NavGroup>
          )}

          {isAdmin && !inProjectScope && (
            <NavGroup title="Administration">
              <NavItem to="/admin/orgs" icon="grid" label="Organisations" />
              <NavItem to="/admin/users" icon="users" label="Users" />
              <NavItem to="/admin/projects" icon="folder" label="Projects" />
              <NavItem to="/admin/datasets" icon="list" label="Datasets" />
            </NavGroup>
          )}
        </div>

        <div className="sidebar-footer">
          <ThemeToggle />
          {user && (
            <div className="sidebar-user" title={user.email}>
              <span className="sidebar-avatar" aria-hidden="true">
                {initials}
              </span>
              <span className="sidebar-label sidebar-user-text">
                <span className="sidebar-user-name">{user.name || user.email}</span>
                <span className="sidebar-user-role">{isAdmin ? "Super admin" : activeOrg ? roleLabel(activeOrg.role) : "Member"}</span>
              </span>
              <button
                className="sidebar-signout"
                onClick={() => authService.logout()}
                title="Sign out"
                aria-label="Sign out"
              >
                <Icon name="logout" />
              </button>
            </div>
          )}
        </div>
      </aside>

      {mobileOpen && <div className="sidebar-backdrop" onClick={() => setMobileOpen(false)} />}

      <main className="shell-main">
        <ShellProjectContext.Provider value={{ project: shellProject, setProject: setShellProject }}>
          <Outlet />
        </ShellProjectContext.Provider>
      </main>
    </div>
  );
}

/**
 * The project's own menu: its seven sections, the version switcher and the
 * way out. For a platform admin the way out is the platform-wide Projects
 * list they came in from, since they have no organisation menu to go back to.
 */
function ProjectNav({
  orgId,
  projectId,
  name,
  isAdmin,
}: {
  orgId: string;
  projectId: string;
  name: string;
  isAdmin: boolean;
}) {
  const base = `/orgs/${orgId}/projects/${projectId}`;
  return (
    <>
      <div className="sidebar-scope stacked">
        <div className="sidebar-field">
          <span className="sidebar-label sidebar-field-name">Project</span>
          <span className="sidebar-scope-value sidebar-label" title={name}>
            {name}
          </span>
        </div>
        <VersionSwitcher orgId={orgId} projectId={projectId} />
      </div>
      <NavGroup>
        <NavItem to={`${base}/details`} icon="info" label="Project details" />
        <NavItem to={`${base}/use-cases`} icon="usecase" label="Use case diagram" />
        <NavItem to={`${base}/personas`} icon="persona" label="Personas" />
        <NavItem to={`${base}/diagrams`} icon="diagram" label="Diagrams" />
        <NavItem to={`${base}/wireframes`} icon="layout" label="Wireframes" />
        <NavItem to={`${base}/documents`} icon="file" label="Documents" />
        <NavItem to={`${base}/plan`} icon="plan" label="Plan" />
        <NavItem to={`${base}/roadmap`} icon="roadmap" label="Roadmap" />
        <NavItem to={`${base}/epics`} icon="epic" label="Epics" />
      </NavGroup>
      {isAdmin ? (
        <NavGroup title="Administration">
          <NavItem to="/admin/projects" icon="arrowLeft" label="Back to projects" end />
        </NavGroup>
      ) : (
        <NavGroup title="Organisation">
          <NavItem to={`/orgs/${orgId}/projects`} icon="arrowLeft" label="Back to organisation" end />
        </NavGroup>
      )}
    </>
  );
}

/**
 * Move between versions of this project.
 *
 * A version is a project row of its own, so switching is an ordinary
 * navigation -- there is no state to reconcile. Renders nothing until a project
 * actually has more than one version, so the common case is unchanged.
 */
function VersionSwitcher({ orgId, projectId }: { orgId: string; projectId: string }) {
  const versions = useLoad(() => listProjectVersions(projectId), [projectId]);
  const navigate = useNavigate();
  const all = versions.data ?? [];
  if (all.length < 2) return null;

  return (
    <div className="sidebar-field">
      <span className="sidebar-label sidebar-field-name">Version</span>
      <select
        className="select sidebar-scope-select"
        value={projectId}
        onChange={(e) => navigate(`/orgs/${orgId}/projects/${e.target.value}/details`)}
        aria-label="Switch version"
      >
        {[...all].reverse().map((version) => (
          <option key={version.id} value={version.id}>
            v{version.version_no}
            {version.version_label ? ` · ${version.version_label}` : ""}
            {version.locked_at !== null ? " (locked)" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

const COLLAPSED_KEY = "ferrous.sidebar.collapsed";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function roleLabel(role: string): string {
  const r = role.replace(/^account_/, "").replace(/_/g, " ");
  return r.charAt(0).toUpperCase() + r.slice(1);
}

function NavGroup({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <nav className="sidebar-group" aria-label={title}>
      {title && <div className="sidebar-group-title sidebar-label">{title}</div>}
      {children}
    </nav>
  );
}

function NavItem({ to, icon, label, end }: { to: string; icon: IconName; label: string; end?: boolean }) {
  return (
    <NavLink to={to} end={end} className="sidebar-item" title={label}>
      <span className="sidebar-icon">
        <Icon name={icon} />
      </span>
      <span className="sidebar-label">{label}</span>
    </NavLink>
  );
}

type IconName =
  | "folder"
  | "grid"
  | "users"
  | "logout"
  | "menu"
  | "info"
  | "list"
  | "persona"
  | "usecase"
  | "diagram"
  | "layout"
  | "file"
  | "plan"
  | "roadmap"
  | "epic"
  | "arrowLeft";

const PATHS: Record<IconName, ReactNode> = {
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4.5-6.2" />
    </>
  ),
  logout: <path d="M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5M15 8l4 4-4 4M19 12H9" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  list: <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />,
  persona: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20a8 8 0 0 1 16 0" />
    </>
  ),
  usecase: (
    <>
      <circle cx="6" cy="6" r="2.5" />
      <path d="M6 8.5v6M3 11h6M6 14.5l-2.5 4M6 14.5l2.5 4" />
      <ellipse cx="16" cy="12" rx="5" ry="3" />
      <path d="M9 11h2" />
    </>
  ),
  diagram: (
    <>
      <rect x="3" y="3" width="7" height="6" rx="1" />
      <rect x="14" y="15" width="7" height="6" rx="1" />
      <path d="M10 6h4v9" />
    </>
  ),
  layout: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18M9 9v11" />
    </>
  ),
  file: (
    <>
      <path d="M6 3h8l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v5h5" />
    </>
  ),
  plan: (
    <>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M8 2.5v3M16 2.5v3M3 9.5h18" />
      <path d="M7.5 14l1.5 1.5 3-3" />
      <path d="M14.5 18h3" />
    </>
  ),
  roadmap: (
    <>
      <path d="M4 19c4-2 4-8 8-10s4-6 8-6" />
      <circle cx="4" cy="19" r="1.5" />
      <circle cx="12" cy="9" r="1.5" />
      <circle cx="20" cy="3" r="1.5" />
    </>
  ),
  epic: (
    <>
      <path d="M13 2L4 14h7l-1 8 9-12h-7z" />
    </>
  ),
  arrowLeft: <path d="M19 12H5M11 6l-6 6 6 6" />,
};

function Icon({ name }: { name: IconName }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
