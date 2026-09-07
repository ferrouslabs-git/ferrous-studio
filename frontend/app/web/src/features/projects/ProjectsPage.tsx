// Projects in the active organisation, as a list: one row per project showing
// its current version, with older versions expanding beneath it. Viewers get a
// read-only list; writers can create, rename, version, archive and delete.
// Write affordances are hidden for viewers but the server enforces data:write
// regardless. The list itself is shared with the platform-wide admin one.
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useSession } from "../../app/session";
import { ListToolbar, matches } from "../../components/ListToolbar";
import { useLoad } from "../../core/useLoad";
import { ProjectFormDrawer } from "./ProjectFormDrawer";
import { ProjectsList, toLineages } from "./ProjectsList";
import { listProjects, projectPath } from "./projectsApi";

export function ProjectsPage() {
  const { orgId } = useParams();
  const { activeOrg, canWrite, selectOrg } = useSession();

  // The URL names an organisation; make it the active one if it is not already
  // (deep links, back/forward). The sidebar switcher navigates here itself.
  useEffect(() => {
    if (orgId && activeOrg && orgId !== activeOrg.id) void selectOrg(orgId);
  }, [orgId, activeOrg, selectOrg]);

  const projects = useLoad(async () => (activeOrg ? listProjects() : []), [activeOrg?.id]);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"active" | "archived" | "all">("active");

  const all = projects.data ?? [];
  const lineages = useMemo(() => toLineages(all), [all]);
  const visible = useMemo(() => {
    // A lineage shows if any of its versions matches: searching for a project
    // should find it whichever version happens to be newest.
    return lineages.filter(({ versions }) =>
      versions.some((p) => {
        if (statusFilter !== "all" && p.status !== statusFilter) return false;
        return matches(query, p.name, p.description);
      }),
    );
  }, [lineages, query, statusFilter]);
  const filtered = query.trim() !== "" || statusFilter !== "active";

  // After the hooks, never before: an early return above them would change the
  // hook count between renders the moment the active organisation clears.
  if (!activeOrg) {
    return (
      <div className="page">
        <div className="empty">No organisation selected. Ask an administrator to add you to one.</div>
      </div>
    );
  }

  return (
    <div className="page stack">
      <div className="page-head">
        <h1>Projects</h1>
        <span className="shell-spacer" />
        {canWrite && (
          <button className="btn primary" onClick={() => setCreating(true)}>
            New project
          </button>
        )}
      </div>

      <ListToolbar
        search={{ value: query, onChange: setQuery, placeholder: "Search by name or description", label: "Search projects" }}
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

      <ProjectFormDrawer
        open={creating}
        project={null}
        onClose={() => setCreating(false)}
        onSaved={projects.reload}
      />

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
              <b>No projects yet.</b> {canWrite ? "Create one to start wireframing." : "Nothing has been shared with you here."}
            </>
          )
        }
        reload={projects.reload}
        hrefOf={(project) => projectPath(activeOrg.id, project.id)}
      />
    </div>
  );
}
