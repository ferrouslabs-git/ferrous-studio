// Super admin: every project on the platform, whichever organisation owns it.
// The same list an organisation sees of its own projects, with a column naming
// the owner -- so a project can be created, renamed, archived or deleted from
// here without first switching the whole session over to its organisation.
// Opening one still switches, because the project's own pages are org-scoped.
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useSession } from "../../app/session";
import { ListToolbar, matches } from "../../components/ListToolbar";
import { errorMessage } from "../../core/api";
import { getPlatformTenants } from "../../core/umApi";
import { useLoad } from "../../core/useLoad";
import { ProjectFormDrawer } from "../projects/ProjectFormDrawer";
import { ProjectsList, toLineages } from "../projects/ProjectsList";
import { AdminProject, listAllProjects, orgScope, projectPath } from "../projects/projectsApi";

export function AdminProjectsPage() {
  const projects = useLoad(listAllProjects, []);
  const tenants = useLoad(getPlatformTenants, []);
  const { canWrite, selectOrg } = useSession();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"active" | "archived" | "all">("active");

  // A suspended organisation is closed for business, so it is not offered as a
  // home for a new project. Sorted by name: the picker is a list to scan.
  const orgOptions = useMemo(
    () =>
      (tenants.data ?? [])
        .filter((t) => t.status === "active")
        .map((t) => ({ id: t.tenant_id, name: t.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [tenants.data],
  );

  // Opening a project switches this session to its organisation first, so the
  // sidebar and scope stay in step with the project's URL.
  const open = async (project: AdminProject) => {
    setError(null);
    try {
      await selectOrg(project.account_id);
      navigate(projectPath(project.account_id, project.id));
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const all = projects.data ?? [];
  const lineages = useMemo(() => toLineages(all), [all]);
  const visible = useMemo(() => {
    // A lineage shows if any of its versions matches: searching for a project
    // should find it whichever version happens to be newest.
    return lineages.filter(({ versions }) =>
      versions.some((p) => {
        if (statusFilter !== "all" && p.status !== statusFilter) return false;
        return matches(query, p.name, p.account_name, p.description);
      }),
    );
  }, [lineages, query, statusFilter]);
  const filtered = query.trim() !== "" || statusFilter !== "active";

  return (
    <div className="page stack">
      <div className="page-head">
        <h1>Projects</h1>
        <span className="shell-spacer" />
        {canWrite && (
          <button className="btn primary" onClick={() => setCreating(true)} disabled={tenants.loading}>
            New project
          </button>
        )}
      </div>

      <ProjectFormDrawer
        open={creating}
        project={null}
        orgs={orgOptions}
        onClose={() => setCreating(false)}
        onSaved={projects.reload}
      />

      <ListToolbar
        search={{
          value: query,
          onChange: setQuery,
          placeholder: "Search by name, organisation or description",
          label: "Search projects",
        }}
        filters={[
          {
            label: "Filter by status",
            value: statusFilter,
            defaultValue: "active",
            onChange: (v) => setStatusFilter(v as "active" | "archived" | "all"),
            options: [
              { value: "active", label: "Active" },
              { value: "archived", label: "Archived" },
              { value: "all", label: "All statuses" },
            ],
          },
        ]}
        count={{ visible: visible.length, total: lineages.length, noun: ["project", "projects"] }}
      />

      {error && <div className="status-banner warn">{error}</div>}

      <ProjectsList
        lineages={visible}
        canWrite={canWrite}
        loading={projects.loading}
        error={projects.error}
        empty={
          filtered ? (
            "No projects match these filters."
          ) : (
            <>
              <b>No projects yet.</b> Create one for an organisation, or wait for one to create its own.
            </>
          )
        }
        reload={projects.reload}
        hrefOf={(project) => projectPath(project.account_id, project.id)}
        onOpen={(project) => void open(project)}
        orgColumn={{
          header: "Organisation",
          render: (project) => <Link to={`/orgs/${project.account_id}/projects`}>{project.account_name}</Link>,
        }}
        optsOf={(project) => orgScope(project.account_id)}
      />
    </div>
  );
}
