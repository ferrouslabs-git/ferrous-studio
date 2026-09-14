// One epic on the Epics tab. The head is the epic -- id, lifecycle chip
// (click to advance), title, the release it is in as a chip, progress,
// effort, comments, delete -- and ▾ folds open its FEATURES, each with its own
// requirement progress, plus the requirements filed straight under the epic.
// Which release an epic is in is decided on the Roadmap; here it is only
// shown. Ported from the reference app's epicCard/epicFeatureRow
// (static/js/roadmap.js).
import { MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useBoard } from "../board/boardData";
import { useBoardMutations } from "../board/boardMutations";
import { CommentButton, EffortFigure, EpicStatusChip, IdChip, ProgressFigure, SegBar } from "../board/chips";
import type { CommentsTarget } from "../board/CommentsPanel";
import { useDialogs } from "../board/dialogs";
import { rollup, type Rollup } from "../board/effort";
import type { Epic } from "../board/epicsApi";

interface EpicCardProps {
  epic: Epic;
  folded: boolean;
  onToggleFold: () => void;
  onComments: (target: CommentsTarget) => void;
}

export function EpicCard({ epic, folded, onToggleFold, onComments }: EpicCardProps) {
  const { index, paths, canWrite } = useBoard();
  const mutations = useBoardMutations();
  const dialogs = useDialogs();
  const navigate = useNavigate();

  const requirements = index.epicRequirements(epic.id);
  const p = rollup(requirements);
  const release = epic.release_id ? index.releaseById.get(epic.release_id) ?? null : null;
  const features = index.featuresOf(epic.id);
  // Filed straight under the epic, not under one of its features.
  const loose = requirements.filter((r) => r.epic_id === epic.id && !r.feature_id);

  const openEpic = () => navigate(paths.epic(epic.id));

  // The head is one target: click anywhere on it → the epic page. The status
  // chip and the buttons are controls of their own and must not navigate.
  const onHeadClick = (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button, .bchip.st")) return;
    openEpic();
  };

  const advance = () => {
    mutations.advanceEpicStatus(epic).catch(() => {
      // The mutation has already toasted the server's reason.
    });
  };

  const remove = async () => {
    const ok = await dialogs.confirm({
      title: "Delete epic",
      ok: "Delete epic",
      message:
        `Delete ${epic.human_id} "${epic.title}"?\n` +
        `Its features will be deleted; its ${p.total} requirement(s) will be untagged (not deleted), and its comments removed.`,
    });
    if (!ok) return;
    try {
      await mutations.deleteEpic(epic);
    } catch {
      // Toasted by the mutation.
    }
  };

  return (
    <div className={`mscard epc${folded ? " ep-folded" : ""}`}>
      <div className="mshead ep-head" onClick={onHeadClick}>
        <button
          type="button"
          className="btn mini-x ep-fold"
          title="show / hide its features"
          onClick={(e) => {
            e.stopPropagation();
            onToggleFold();
          }}
        >
          {folded ? "▸" : "▾"}
        </button>
        <IdChip>{epic.human_id}</IdChip>
        <EpicStatusChip status={epic.status} onAdvance={canWrite ? advance : undefined} />
        <span className="ep-ttl" title="open the epic">
          {epic.title}
        </span>
        {release ? (
          <span className="bchip ep-relchip" title={`in ${release.human_id} · ${release.title} — move it on the Roadmap`}>
            {release.human_id}
          </span>
        ) : (
          <span className="bchip ep-relchip ep-norel" title="in no release — put it in one on the Roadmap">
            no release
          </span>
        )}
        <SegBar done={p.done} partial={p.doing + p.review} total={p.total} />
        <ProgressFigure rollup={p} />
        <EffortFigure rollup={p} />
        <span className="spacer" />
        <CommentButton
          count={index.commentCount(epic.id)}
          onClick={() => onComments({ type: "epic", id: epic.id, label: `${epic.human_id} · ${epic.title}` })}
        />
        {canWrite && (
          <button
            type="button"
            className="btn mini-x danger-ink"
            title="delete epic"
            onClick={(e) => {
              e.stopPropagation();
              void remove();
            }}
          >
            ✕
          </button>
        )}
      </div>
      <div className="ep-sum">{epic.summary || ""}</div>
      <div className="ep-features">
        {features.map((f) => (
          <FeatureRow key={f.id} k={f.human_id} title={f.title} rollup={rollup(index.featureRequirements(f.id))} onClick={openEpic} />
        ))}
        {loose.length > 0 && <FeatureRow k="—" title="Requirements with no feature yet" rollup={rollup(loose)} onClick={openEpic} />}
        {features.length === 0 && loose.length === 0 && (
          <div className="hempty">No features or requirements yet — add them on the epic page.</div>
        )}
      </div>
    </div>
  );
}

// One feature inside an epic card (or, with k "—", the requirements that sit
// directly under the epic with no feature yet).
function FeatureRow({ k, title, rollup: p, onClick }: { k: string; title: string; rollup: Rollup; onClick: () => void }) {
  return (
    <div className="hrow ep-frow" onClick={onClick}>
      <span className="k">{k}</span>
      <span className="t">{title}</span>
      <SegBar done={p.done} partial={p.doing + p.review} total={p.total} width={90} />
      <ProgressFigure rollup={p} />
      <EffortFigure rollup={p} />
    </div>
  );
}
