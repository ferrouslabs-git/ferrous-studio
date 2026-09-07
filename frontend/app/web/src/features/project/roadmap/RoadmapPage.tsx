// A project's roadmap: what is coming, in what order, and roughly when.
//
// Placeholder — the section, its route and its menu entry are in place so the
// roadmap has somewhere to live; the content is still to be designed.
import { useProject } from "../ProjectLayout";

export function RoadmapPage() {
  const { canWrite } = useProject();

  return (
    <div className="page stack">
      <div className="page-head">
        <h1>Roadmap</h1>
      </div>

      <div className="empty">
        <b>No roadmap yet.</b> {canWrite ? "This section is still being built." : "Nothing here yet."}
      </div>
    </div>
  );
}
