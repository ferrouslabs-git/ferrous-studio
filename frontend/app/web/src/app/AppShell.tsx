// Persistent chrome for signed-in screens: brand, organisation and workspace
// switchers, section links, theme toggle, user menu.
import { Link, NavLink, Outlet } from "react-router-dom";
import { authService } from "../core/auth";
import { useTheme } from "../core/theme";
import { useSession } from "./session";

export function AppShell() {
  const { user, orgs, spaces, activeOrg, activeSpace, selectOrg, selectSpace } = useSession();
  const [theme, toggleTheme] = useTheme();

  return (
    <div className="shell">
      <header className="shell-nav">
        <Link to="/orgs" className="shell-brand">
          Ferrous Studio
        </Link>

        {activeOrg && (
          <div className="shell-scope">
            {orgs.length > 1 ? (
              <select
                className="select"
                aria-label="Organisation"
                value={activeOrg.id}
                onChange={(e) => void selectOrg(e.target.value)}
              >
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            ) : (
              <span>{activeOrg.name}</span>
            )}
            {spaces.length > 1 && activeSpace && (
              <>
                <span className="sep">/</span>
                <select
                  className="select"
                  aria-label="Workspace"
                  value={activeSpace.id}
                  onChange={(e) => selectSpace(e.target.value)}
                >
                  {spaces.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>
        )}

        <nav className="shell-links">
          {activeOrg && <NavLink to={`/orgs/${activeOrg.id}/projects`}>Projects</NavLink>}
          {activeOrg && (
            <NavLink to={`/orgs/${activeOrg.id}`} end>
              Organisation
            </NavLink>
          )}
          {user?.is_platform_admin && <NavLink to="/admin/orgs">Admin</NavLink>}
        </nav>

        <span className="shell-spacer" />
        <button className="btn ghost small" onClick={toggleTheme} title="Toggle theme">
          {theme === "dark" ? "☀ Light" : "☾ Dark"}
        </button>
        {user && <span className="shell-user">{user.email}</span>}
        <button className="btn ghost small" onClick={() => authService.logout()}>
          Sign out
        </button>
      </header>

      <main className="shell-main">
        <Outlet />
      </main>
    </div>
  );
}
