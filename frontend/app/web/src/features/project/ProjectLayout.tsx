// Layout route for /orgs/:orgId/projects/:projectId/*. Loads the project once,
// makes the URL's organisation the active scope, pushes the name up to the
// sidebar, and hands the project to every section page through useProject().
//
// The organisation is in the URL on purpose: a project opens in a new tab,
// where the session would otherwise fall back to the remembered organisation
// and the first request would run under the wrong scope (404).
import { createContext, useContext, useEffect } from "react";
import { Link, Outlet, useParams } from "react-router-dom";
import { useSession } from "../../app/session";
import { useShellProject } from "../../app/shellProject";
import { setActiveScope } from "../../core/scope";
import { useLoad } from "../../core/useLoad";
import { getProject, ProjectDetail } from "../projects/projectsApi";

export interface ProjectContextValue {
  project: ProjectDetail;
  orgId: string;
  canWrite: boolean;
  /** Re-fetch after an edit; the sidebar title follows. */
  reload: () => Promise<void>;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function useProject(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error("useProject must be used inside ProjectLayout");
  return ctx;
}

export function ProjectLayout() {
  const { orgId = "", projectId = "" } = useParams();
  const { user, orgs, activeOrg, selectOrg, canWrite } = useSession();
  const { setProject: setShellProject } = useShellProject();

  const member = !!user?.is_platform_admin || orgs.some((o) => o.id === orgId);
  const scoped = activeOrg?.id === orgId;

  useEffect(() => {
    if (member && !scoped) void selectOrg(orgId);
  }, [member, scoped, orgId, selectOrg]);

  const load = useLoad(async () => {
    if (!scoped) return null;
    // The session effect that syncs the scope can run after this fetch is
    // issued (see AdminProjectsPage for the same race); set it directly too.
    setActiveScope({ type: "account", id: orgId });
    return getProject(projectId);
  }, [projectId, orgId, scoped]);

  const project = load.data;

  useEffect(() => {
    if (project) setShellProject({ id: project.id, orgId, name: project.name });
    return () => setShellProject(null);
  }, [project, orgId, setShellProject]);

  if (!member) {
    return (
      <div className="page">
        <div className="empty">
          <b>You are not a member of this organisation.</b> <Link to="/orgs">Your organisations</Link>
        </div>
      </div>
    );
  }
  if (load.error) {
    return (
      <div className="page">
        <div className="empty error">
          <b>{load.error === "Project not found" ? "Project not found." : load.error}</b>{" "}
          <Link to={`/orgs/${orgId}/projects`}>Back to projects</Link>
        </div>
      </div>
    );
  }
  if (!project) return <div className="page muted">Loading…</div>;

  return (
    <ProjectContext.Provider value={{ project, orgId, canWrite, reload: load.reload }}>
      <Outlet />
    </ProjectContext.Provider>
  );
}

/** Older links pointed at /projects/:id with no organisation; resolve one. */
export function LegacyProjectRedirect() {
  const { projectId = "" } = useParams();
  const load = useLoad(() => getProject(projectId), [projectId]);
  if (load.data) {
    window.location.replace(`/orgs/${load.data.account_id}/projects/${projectId}`);
    return null;
  }
  if (load.error) {
    return (
      <div className="page">
        <div className="empty">
          <b>This link has moved.</b> Open the project from its organisation's <Link to="/orgs">Projects</Link> list.
        </div>
      </div>
    );
  }
  return <div className="page muted">Loading…</div>;
}
