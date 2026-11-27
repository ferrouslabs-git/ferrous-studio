// One usability study. Everything about a round of testing lives under it, as
// sub-sections: the study itself (what is tested), the booking emails and the
// times participants can book, its participants, the observation capture for
// each participant, and the study's insights.
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { errorMessage } from "../../../core/api";
import { useLoad } from "../../../core/useLoad";
import { useProject } from "../ProjectLayout";
import { StudyCapture } from "./StudyCapture";
import { StudyEditor } from "./StudyEditor";
import { StudyEmails } from "./StudyEmails";
import { StudyInsights } from "./StudyInsights";
import { StudyParticipants } from "./StudyParticipants";
import { StudySlots } from "./StudySlots";
import { getStudy, updateStudy } from "./usabilityApi";

const SECTIONS = [
  { id: "study", label: "Study" },
  { id: "emails", label: "Emails" },
  { id: "slots", label: "Slots" },
  { id: "participants", label: "Participants" },
  { id: "capture", label: "Observation capture" },
  { id: "insights", label: "Study insights" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

export function StudyPage() {
  const { project, canWriteBoard } = useProject();
  const { orgId = "", studyId = "", section, participantId } = useParams();
  const navigate = useNavigate();
  const study = useLoad(() => getStudy(project.id, studyId), [project.id, studyId]);
  const [error, setError] = useState<string | null>(null);

  const active: SectionId = SECTIONS.some((s) => s.id === section) ? (section as SectionId) : "study";
  const root = `/orgs/${orgId}/projects/${project.id}/usability`;
  const go = (id: SectionId, participant?: string) =>
    navigate(`${root}/${studyId}${id === "study" ? "" : `/${id}`}${participant ? `/${participant}` : ""}`);

  if (!canWriteBoard) {
    return (
      <div className="page stack">
        <div className="empty">
          <b>Usability studies are run by organisation admins.</b>
        </div>
      </div>
    );
  }
  if (study.loading && !study.data) return <div className="page muted">Loading…</div>;
  if (study.error || !study.data) {
    return (
      <div className="page stack">
        <div className="usab-warning" role="alert">
          {study.error ?? "Study not found."}
        </div>
        <div>
          <button className="btn ghost" onClick={() => navigate(root)}>
            All studies
          </button>
        </div>
      </div>
    );
  }
  const data = study.data;
  const closed = data.status === "closed";

  const setStatus = async (status: "open" | "closed") => {
    setError(null);
    try {
      await updateStudy(project.id, data.id, { status });
      await study.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <div className="page stack usab-page">
      <div className="page-head">
        <h1>{data.name}</h1>
        <span className="shell-spacer" />
        <button className="btn ghost" onClick={() => void setStatus(closed ? "open" : "closed")}>
          {closed ? "Reopen study" : "Close study"}
        </button>
      </div>
      {closed && (
        <div className="usab-warning" role="status">
          This study is closed, so its participants' links no longer work.
        </div>
      )}
      {error && (
        <div className="usab-warning" role="alert">
          {error}
        </div>
      )}

      <div className="page-subtabs" role="tablist" aria-label="Study">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={active === s.id}
            className={`page-subtab${active === s.id ? " active" : ""}`}
            onClick={() => go(s.id)}
          >
            {s.label}
            {s.id === "participants" && <span className="page-subtab-count">{data.participant_list.length}</span>}
          </button>
        ))}
      </div>

      {active === "study" && <StudyEditor key={data.id} projectId={project.id} study={data} onSaved={study.reload} />}
      {active === "emails" && <StudyEmails key={data.id} projectId={project.id} study={data} onSaved={study.reload} />}
      {active === "slots" && <StudySlots key={data.id} projectId={project.id} study={data} onSaved={study.reload} />}
      {active === "participants" && (
        <StudyParticipants
          projectId={project.id}
          study={data}
          onChanged={study.reload}
          onOpenCapture={(id) => go("capture", id)}
        />
      )}
      {active === "capture" && (
        <StudyCapture
          projectId={project.id}
          study={data}
          participantId={participantId}
          onPick={(id) => go("capture", id)}
        />
      )}
      {active === "insights" && <StudyInsights projectId={project.id} study={data} />}
    </div>
  );
}
