// A project's epics: the large bodies of work the roadmap is made of.
//
// Placeholder — the section, its route and its menu entry are in place so the
// epics have somewhere to live; the content is still to be designed.
import { useProject } from "../ProjectLayout";

export function EpicsPage() {
  const { canWrite } = useProject();

  return (
    <div className="page stack">
      <div className="page-head">
        <h1>Epics</h1>
      </div>

      <div className="empty">
        <b>No epics yet.</b> {canWrite ? "This section is still being built." : "Nothing here yet."}
      </div>
    </div>
  );
}
