// Planned work (FS-REQ-103): the work that is in a release. Two sub-tabs
// under the title, driven by ?tab= as on the use case and Unplanned work
// pages so a tab can be linked to: Roadmap (the release timeline, the
// default) and Epics (the epic list, narrowed to epics filed in a release).
// Every epic, planned or not, is on Unplanned work.
import { useSearchParams } from "react-router-dom";
import { useBoard } from "../board/boardData";
import { EpicsPage } from "../epics/EpicsPage";
import { RoadmapPage } from "./RoadmapPage";

type Tab = "roadmap" | "epics";

const TABS: { id: Tab; label: string }[] = [
  { id: "roadmap", label: "Roadmap" },
  { id: "epics", label: "Epics" },
];

export function PlannedWorkPage() {
  const { index } = useBoard();
  const [params, setParams] = useSearchParams();
  const rawTab = params.get("tab");
  const tab: Tab = TABS.some((t) => t.id === rawTab) ? (rawTab as Tab) : "roadmap";
  const selectTab = (t: Tab) => setParams(t === "roadmap" ? {} : { tab: t }, { replace: true });
  const plannedEpics = index.epics.filter((e) => !!e.release_id && index.releaseById.has(e.release_id)).length;

  const head = (
    <>
      <div className="page-head">
        <h1>Planned work</h1>
      </div>
      <div className="page-subtabs" role="tablist" aria-label="Planned work">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`page-subtab${tab === t.id ? " active" : ""}`}
            onClick={() => selectTab(t.id)}
          >
            {t.label}
            {t.id === "epics" && <span className="page-subtab-count">{plannedEpics}</span>}
          </button>
        ))}
      </div>
    </>
  );

  return tab === "epics" ? <EpicsPage planned head={head} /> : <RoadmapPage head={head} />;
}
