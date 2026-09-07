// A project's plan: the phases of work and where the project has got to.
//
// Placeholder — the section, its route and its menu entry are in place so the
// plan has somewhere to live; the content is still to be designed.
import { useProject } from "../ProjectLayout";

export function PlanPage() {
  const { canWrite } = useProject();

  return (
    <div className="page stack">
      <div className="page-head">
        <h1>Plan</h1>
      </div>

      <div className="empty">
        <b>No plan yet.</b> {canWrite ? "This section is still being built." : "Nothing here yet."}
      </div>
    </div>
  );
}
