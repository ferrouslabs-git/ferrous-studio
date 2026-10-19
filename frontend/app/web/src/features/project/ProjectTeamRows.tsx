// The project's team on the details page: the product manager and support
// developer feedback is routed to on Slack, each picked from the super
// admins. Like the key, it belongs to the lineage: it reads the organisation
// role rather than useProject().canWrite and stays editable on a locked
// version (set_board_team is lock-exempt on the server). A pick saves at once.
import { useSession } from "../../app/session";
import { AutosaveStatus } from "../../components/AutosaveStatus";
import { useAutosave } from "../../core/useAutosave";
import { useLoad } from "../../core/useLoad";
import { listAssignees } from "./board/assigneesApi";
import { BoardTeam, getBoardTeam, setBoardTeam } from "./board/boardTeamApi";
import { useProject } from "./ProjectLayout";

const ROLES: { key: keyof BoardTeam; label: string }[] = [
  { key: "product_manager_id", label: "Product manager" },
  { key: "support_dev_id", label: "Support developer" },
];

export function ProjectTeamRows() {
  const { project } = useProject();
  const team = useLoad(() => getBoardTeam(project.id), [project.id]);
  const people = useLoad(() => listAssignees(project.id), [project.id]);
  if (team.error) {
    return (
      <>
        <div className="details-label">Team</div>
        <div className="details-value muted">{team.error}</div>
      </>
    );
  }
  if (!team.data || !people.data) {
    return (
      <>
        <div className="details-label">Team</div>
        <div className="details-value muted">Loading…</div>
      </>
    );
  }
  return <TeamRows projectId={project.id} initial={team.data} admins={people.data.filter((p) => p.super_admin)} />;
}

function TeamRows({ projectId, initial, admins }: { projectId: string; initial: BoardTeam; admins: { user_id: string; name: string }[] }) {
  const { canWrite } = useSession();
  const form = useAutosave(initial, { save: (v) => setBoardTeam(projectId, v) });
  const nameOf = (id: string | null) => (id ? admins.find((a) => a.user_id === id)?.name ?? "No longer a super admin" : null);

  return (
    <>
      {ROLES.map(({ key, label }, i) => (
        <div key={key} style={{ display: "contents" }}>
          <div className="details-label">{label}</div>
          <div className="details-value env-row">
            {canWrite ? (
              <select
                className="select"
                aria-label={label}
                value={form.value[key] ?? ""}
                onChange={(e) => form.set({ [key]: e.target.value || null } as Partial<BoardTeam>, { immediate: true })}
              >
                <option value="">— not set —</option>
                {admins.map((a) => (
                  <option key={a.user_id} value={a.user_id}>
                    {a.name}
                  </option>
                ))}
                {form.value[key] && !admins.some((a) => a.user_id === form.value[key]) && (
                  <option value={form.value[key]!}>No longer a super admin</option>
                )}
              </select>
            ) : (
              <span className={form.value[key] ? undefined : "muted"}>{nameOf(form.value[key]) ?? "Not set"}</span>
            )}
            {canWrite && i === ROLES.length - 1 && <AutosaveStatus auto={form} />}
          </div>
        </div>
      ))}
    </>
  );
}
