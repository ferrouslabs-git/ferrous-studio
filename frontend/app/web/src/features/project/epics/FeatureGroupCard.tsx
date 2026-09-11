// One group of requirements on the epic page: a feature (renamable, with
// comments, attachments and delete), or the "Unassigned" group for the
// requirements attached to the epic with no feature yet. Each row opens
// that requirement in the pane beside the epic. Ported from epgGroupCard()
// in the reference app's static/js/epicpage.js.
import { useState } from "react";
import { AttachmentsSection } from "../board/AttachmentsSection";
import { useBoard } from "../board/boardData";
import { useBoardMutations } from "../board/boardMutations";
import { CommentButton, EffortFigure, IdChip, StatusChip } from "../board/chips";
import type { CommentsTarget } from "../board/CommentsPanel";
import { useDialogs } from "../board/dialogs";
import { rollup } from "../board/effort";
import type { Epic } from "../board/epicsApi";
import type { Feature } from "../board/featuresApi";
import { InlineText } from "../board/InlineText";
import type { RequirementPreset } from "../board/RequirementDrawer";
import type { Requirement } from "../board/requirementsApi";

interface FeatureGroupCardProps {
  epic: Epic;
  /** Null for the requirements filed directly under the epic. */
  feature: Feature | null;
  rows: Requirement[];
  selectedReq: string | null;
  onSelectReq: (id: string) => void;
  onNewRequirement: (preset: RequirementPreset) => void;
  onOpenComments: (target: CommentsTarget) => void;
}

export function FeatureGroupCard({ epic, feature: f, rows, selectedReq, onSelectReq, onNewRequirement, onOpenComments }: FeatureGroupCardProps) {
  const { index, canWrite } = useBoard();
  const mutations = useBoardMutations();
  const dialogs = useDialogs();
  // Attachments need a fetch (unlike the requirements, already on the
  // board), so the section is mounted on first expand, not for every group
  // on every render.
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const p = rollup(rows);

  const remove = async () => {
    if (!f) return;
    const ok = await dialogs.confirm({
      title: "Delete feature",
      ok: "Delete feature",
      message: `Delete ${f.human_id} "${f.title}"?\nIts ${rows.length} requirement(s) will be untagged (not deleted), and its comments removed.`,
    });
    if (!ok) return;
    await mutations.deleteFeature(f).catch(() => undefined);
  };

  return (
    <div className="mscard" style={{ marginBottom: 14 }}>
      <div className="mshead">
        {f && <IdChip>{f.human_id}</IdChip>}
        {f ? (
          <InlineText className="ms-ttl" value={f.title} disabled={!canWrite} onSave={(v) => mutations.patchFeature(f.id, v).catch(() => undefined)} />
        ) : (
          <span className="ms-ttl" style={{ cursor: "default" }}>
            Unassigned
          </span>
        )}
        <EffortFigure rollup={p} />
        <span style={{ marginLeft: "auto" }} />
        {canWrite && (
          <button
            type="button"
            className="btn mini-x"
            title={f ? "new requirement under this feature" : "new requirement directly under this epic"}
            onClick={() => onNewRequirement({ epicId: epic.id, featureId: f ? f.id : null })}
          >
            + Requirement
          </button>
        )}
        {f && (
          <CommentButton
            count={index.commentCount(f.id)}
            onClick={() => onOpenComments({ type: "feature", id: f.id, label: `${f.human_id} · ${f.title}` })}
          />
        )}
        {f && canWrite && (
          <button type="button" className="btn mini-x danger-ink" title="delete feature" onClick={() => void remove()}>
            ✕
          </button>
        )}
      </div>
      <div className="epg-items">
        {rows.length === 0 ? (
          <div className="hempty">Nothing here yet.</div>
        ) : (
          rows.map((r) => (
            <div key={r.id} className={`hrow${r.id === selectedReq ? " sel" : ""}`} onClick={() => onSelectReq(r.id)}>
              <span className="k">{r.human_id}</span>
              <span className="t">{r.title}</span>
              <span className="r">
                <StatusChip status={r.status} />
              </span>
            </div>
          ))
        )}
      </div>
      {f && (
        <details className="ft-att" onToggle={(e) => setAttachmentsOpen((e.currentTarget as HTMLDetailsElement).open)}>
          <summary>attachments</summary>
          {attachmentsOpen && <AttachmentsSection entityType="feature" entityId={f.id} />}
        </details>
      )}
    </div>
  );
}
