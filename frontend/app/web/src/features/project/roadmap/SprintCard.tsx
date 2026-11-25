// One sprint on the release page: id, state, name and days left; board ↗,
// the lifecycle control, comments, delete and fold; the goal; dates and
// release; progress; the requirement
// list in agent order; and the burndown. The WHOLE card is the drop target,
// not just the list -- an empty sprint's list is one line tall, which is no
// target at all. Ported from the reference app's spCard() and spLifecycle()
// (static/js/sprints.js).
import { useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useBoard } from "../board/boardData";
import { closeSprintMessage, spOrdered, sprintDue, sprintLifecycle } from "../board/boardModel";
import { useBoardMutations } from "../board/boardMutations";
import { BurndownDetails } from "../board/Burndown";
import { CommentButton, DeliveryStatusSelect, DueChip, IdChip, ProgressBar } from "../board/chips";
import { useDialogs } from "../board/dialogs";
import { useDropTarget } from "../board/dnd";
import { rollup } from "../board/effort";
import { InlineText } from "../board/InlineText";
import type { Requirement } from "../board/requirementsApi";
import type { Sprint, SprintPatch } from "../board/sprintsApi";
import { useToast } from "../board/toast";
import { SprintRequirementRow } from "./SprintRequirementRow";

interface SprintCardProps {
  sprint: Sprint;
  folded: boolean;
  onToggleFold: () => void;
  onOpenRequirement: (r: Requirement) => void;
  onComments: () => void;
}

export function SprintCard({ sprint, folded, onToggleFold, onOpenRequirement, onComments }: SprintCardProps) {
  const { index, paths, canWrite } = useBoard();
  const mutations = useBoardMutations();
  const dialogs = useDialogs();
  const toast = useToast();
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  // Closed, not "status is some finished value": the status is a free label
  // that never locks anything (see boardModel.sprintLifecycle).
  const done = !!sprint.closed_at;

  const reqs = index.sprintRequirements(sprint.id);
  const ordered = spOrdered(reqs);
  const todo = ordered.filter((r) => r.status === "NotStarted");
  const p = rollup(reqs);
  const due = sprintDue(sprint);
  const life = sprintLifecycle(sprint);

  const isOver = useDropTarget(ref, {
    accepts: (d) => d.kind === "requirement" && d.from !== sprint.id,
    onDrop: (d) => {
      const r = index.requirementById.get(d.id);
      if (r) void mutations.moveRequirementToSprint(r, sprint.id).catch(() => {});
    },
    disabled: done || !canWrite,
  });

  // Failures are already toasted by the mutation layer.
  const patch = (fields: SprintPatch) => mutations.patchSprint(sprint.id, fields).catch(() => {});

  const runLifecycle = async () => {
    if (life.closed) {
      const ok = await dialogs.confirm({
        title: "Close sprint",
        ok: "Close",
        danger: false,
        message: closeSprintMessage(sprint, reqs),
      });
      if (!ok) return;
    }
    try {
      await mutations.setSprintClosed(sprint, life.closed);
    } catch {
      // Already toasted.
    }
  };

  const remove = async () => {
    const ok = await dialogs.confirm({
      title: "Delete sprint",
      ok: "Delete sprint",
      message: `Delete ${sprint.human_id} "${sprint.name}"?\nIts requirements return to the backlog.`,
    });
    if (!ok) return;
    try {
      await mutations.deleteSprint(sprint);
    } catch {
      // Already toasted.
    }
  };

  // Which release this sprint draws from. Changing it moves the card to that
  // release's page -- and follows it there, so the sprint doesn't just vanish.
  const changeRelease = async (rid: string) => {
    if (!rid || rid === sprint.release_id) return;
    try {
      await mutations.patchSprint(sprint.id, { release_id: rid });
    } catch {
      return;
    }
    const target = index.releaseById.get(rid);
    if (!target) return;
    toast(`${sprint.human_id} moved to ${target.human_id} · ${target.title}`);
    navigate(paths.release(target.id));
  };

  // A date input reads "" while a typed date is still incomplete, so only a
  // complete value commits as you go; clearing one commits on blur.
  const dateField = (key: "start_date" | "end_date") => ({
    onChange: (e: { target: HTMLInputElement }) => {
      if (e.target.value) void patch({ [key]: e.target.value });
    },
    onBlur: (e: { target: HTMLInputElement }) => {
      if (!e.target.value && sprint[key]) void patch({ [key]: null });
    },
  });

  return (
    <div ref={ref} className={`mscard spcard${done ? " sp-dim" : ""}${folded ? " sp-folded" : ""}${isOver ? " is-over" : ""}`}>
      <div className="mshead">
        <IdChip of={{ type: "sprint", id: sprint.id }}>{sprint.human_id}</IdChip>
        <DeliveryStatusSelect
          status={sprint.status}
          disabled={!canWrite}
          label={`${sprint.human_id} status`}
          onChange={(s) => void mutations.setSprintStatus(sprint, s).catch(() => {})}
        />
        <InlineText className="ms-ttl" value={sprint.name} disabled={!canWrite} onSave={(v) => patch({ name: v })} />
        {!done && due && <DueChip due={due} />}
        <span className="spacer" />
        <Link className="btn mini-x sp-board" to={paths.sprint(sprint.id)} title="open this sprint's board">
          board ↗
        </Link>
        {canWrite && (
          <button type="button" className={`btn mini-x${life.primary ? " primary" : ""}`} onClick={() => void runLifecycle()}>
            {life.label}
          </button>
        )}
        <CommentButton count={index.commentCount(sprint.id)} onClick={onComments} />
        {canWrite && (
          <button type="button" className="btn mini-x danger-ink" title="delete sprint" onClick={() => void remove()}>
            ✕
          </button>
        )}
        <button type="button" className="btn mini-x sp-fold" title="fold / unfold the requirement list" onClick={onToggleFold}>
          {folded ? "▸" : "▾"}
        </button>
      </div>
      <InlineText
        as="div"
        className="ms-desc sp-goal"
        multiline
        value={sprint.goal}
        disabled={!canWrite}
        title="sprint goal — double-click to edit"
        onSave={(v) => patch({ goal: v })}
      />
      <div className="sp-meta">
        <label>
          start <input type="date" className="mini" defaultValue={sprint.start_date ?? ""} disabled={!canWrite} {...dateField("start_date")} />
        </label>
        <label>
          end <input type="date" className="mini" defaultValue={sprint.end_date ?? ""} disabled={!canWrite} {...dateField("end_date")} />
        </label>
        <label className="sp-relsel">
          release{" "}
          <select className="mini" value={sprint.release_id ?? ""} disabled={!canWrite} onClick={(e) => e.stopPropagation()} onChange={(e) => void changeRelease(e.target.value)}>
            {index.releases.map((m) => (
              <option key={m.id} value={m.id}>
                {m.human_id} · {m.title}
              </option>
            ))}
          </select>
        </label>
        <ProgressBar pct={p.pct} />
        <span className="sp-fig">
          {p.done}/{p.total} done · {p.pct}%
        </span>
      </div>
      <div className="sp-items-head">
        requirements ({p.total})
        <span className="plan-colhint">agents work this order{done ? "" : " · drop here to commit"}</span>
      </div>
      <div className="sp-items">
        {ordered.length ? (
          ordered.map((r) => (
            <SprintRequirementRow
              key={r.id}
              sprint={sprint}
              requirement={r}
              queueIndex={todo.indexOf(r)}
              queueLength={todo.length}
              onOpen={onOpenRequirement}
            />
          ))
        ) : (
          <div className="hempty">
            Nothing in this sprint yet — drag requirements in from the backlog on the right. The order here is the order agents work them.
          </div>
        )}
      </div>
      <BurndownDetails sprintId={sprint.id} />
    </div>
  );
}
