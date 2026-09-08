// Placeholder. The real Plan page arrives with the board (see
// docs/go-live-and-merge-boards.md, phase 4), which owns sprints,
// requirements and their rollups as sub-routes of the project. The API
// clients beside this file are the groundwork for it.
export function PlanPage() {
  return (
    <div className="page stack">
      <div className="page-head">
        <h1>Plan</h1>
      </div>
      <div className="empty">
        <b>Nothing here yet.</b> Sprints and the requirements moving through them will live on this page.
      </div>
    </div>
  );
}
