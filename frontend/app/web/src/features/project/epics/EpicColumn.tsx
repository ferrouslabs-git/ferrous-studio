// The epic itself, down the left of the epic page: id and lifecycle chip,
// title and description as REAL fields (a single click puts a caret in
// them, same as the requirement drawer -- the reference chose these over
// double-click-to-edit text deliberately), then attachments, docs and the
// requirements grouped by feature. Ported from renderEpicPage() in the
// reference app's static/js/epicpage.js.
import { useBoard } from "../board/boardData";
import { useBoardMutations } from "../board/boardMutations";
import { CommentButton, EffortFigure, EpicStatusChip, IdChip } from "../board/chips";
import type { CommentsTarget } from "../board/CommentsPanel";
import { useDialogs } from "../board/dialogs";
import { rollup } from "../board/effort";
import type { Epic } from "../board/epicsApi";
import type { RequirementPreset } from "../board/RequirementDrawer";
import { AttachmentsSection } from "../board/AttachmentsSection";
import { useToast } from "../board/toast";
import { useBlurSave } from "../board/useBlurSave";
import { DocsSection } from "./DocsSection";
import { FeatureGroupCard } from "./FeatureGroupCard";

interface EpicColumnProps {
  epic: Epic;
  selectedReq: string | null;
  selectedDoc: string | null;
  onSelectReq: (id: string) => void;
  onSelectDoc: (id: string) => void;
  /** A freshly created doc opens in the pane straight away, in edit mode. */
  onDocCreated: (id: string) => void;
  onNewRequirement: (preset: RequirementPreset) => void;
  onOpenComments: (target: CommentsTarget) => void;
}

export function EpicColumn({
  epic,
  selectedReq,
  selectedDoc,
  onSelectReq,
  onSelectDoc,
  onDocCreated,
  onNewRequirement,
  onOpenComments,
}: EpicColumnProps) {
  const { index, canWrite } = useBoard();
  const mutations = useBoardMutations();
  const dialogs = useDialogs();
  const toast = useToast();

  const p = rollup(index.epicRequirements(epic.id));
  const features = index.featuresOf(epic.id);
  // Requirements attached to the epic itself, with no feature yet.
  const direct = index.epicRequirements(epic.id).filter((r) => r.epic_id === epic.id && !r.feature_id);

  // The fields are uncontrolled and keyed by the epic, so a board refresh
  // re-rendering this column never moves the caret mid-edit. Failures are
  // already toasted by the mutation layer.
  const titleField = useBlurSave(epic.title, (v) =>
    mutations
      .patchEpic(epic.id, { title: v })
      .then(() => toast("saved"))
      .catch(() => undefined),
  );
  const summaryField = useBlurSave(epic.summary, (v) =>
    mutations
      .patchEpic(epic.id, { summary: v })
      .then(() => toast("saved"))
      .catch(() => undefined),
  );

  const newFeature = async () => {
    const v = await dialogs.form({
      title: "New feature",
      message: `Under ${epic.human_id} · ${epic.title}`,
      ok: "Create",
      fields: [{ key: "title", label: "Feature name", required: true, placeholder: "e.g. Bulk import" }],
    });
    if (!v) return;
    await mutations.createFeature(epic.id, v.title).catch(() => undefined);
  };

  return (
    <>
      <div className="epghead">
        <IdChip>{epic.human_id}</IdChip>
        <EpicStatusChip
          status={epic.status}
          onAdvance={canWrite ? () => void mutations.advanceEpicStatus(epic).catch(() => undefined) : undefined}
        />
        <span className="spacer" />
        <CommentButton
          count={index.commentCount(epic.id)}
          onClick={() => onOpenComments({ type: "epic", id: epic.id, label: `${epic.human_id} · ${epic.title}` })}
        />
      </div>

      <div className="epg-fields">
        <label htmlFor="epgTitle">Title</label>
        <input id="epgTitle" className="epg-ttl-in" key={`${epic.id}:title`} autoComplete="off" disabled={!canWrite} {...titleField} />
        <label htmlFor="epgSummary">Description</label>
        <textarea
          id="epgSummary"
          className="epg-sum-in"
          key={`${epic.id}:summary`}
          placeholder="What does done look like for this epic?"
          disabled={!canWrite}
          {...summaryField}
        />
      </div>

      <div className="epg-section">
        <AttachmentsSection entityType="epic" entityId={epic.id} />
      </div>

      <div className="epg-section">
        <DocsSection epic={epic} selectedDoc={selectedDoc} onSelect={onSelectDoc} onCreated={onDocCreated} />
      </div>

      <div className="epg-section">
        <div className="section-row">
          <h3>Requirements ({p.total})</h3>
          <EffortFigure rollup={p} />
          <span className="spacer" />
          {canWrite && (
            <>
              <button type="button" className="btn mini-x" title="new requirement under this epic" onClick={() => onNewRequirement({ epicId: epic.id })}>
                + Requirement
              </button>
              <button type="button" className="btn mini-x" title="new feature under this epic" onClick={() => void newFeature()}>
                + Feature
              </button>
            </>
          )}
        </div>
        <div className="epg-groups" style={{ marginTop: 14 }}>
          {direct.length > 0 && (
            <FeatureGroupCard
              epic={epic}
              feature={null}
              rows={direct}
              selectedReq={selectedReq}
              onSelectReq={onSelectReq}
              onNewRequirement={onNewRequirement}
              onOpenComments={onOpenComments}
            />
          )}
          {features.map((f) => (
            <FeatureGroupCard
              key={f.id}
              epic={epic}
              feature={f}
              rows={index.featureRequirements(f.id)}
              selectedReq={selectedReq}
              onSelectReq={onSelectReq}
              onNewRequirement={onNewRequirement}
              onOpenComments={onOpenComments}
            />
          ))}
          {!direct.length && !features.length && (
            <div className="hempty">
              No requirements under this epic yet — "+ Requirement" adds one directly, "+ Feature" makes a named group first.
            </div>
          )}
        </div>
      </div>
    </>
  );
}
