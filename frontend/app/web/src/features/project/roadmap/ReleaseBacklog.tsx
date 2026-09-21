// The release page's right column: every requirement whose EFFECTIVE release
// is this one and that sits in no sprint, grouped by epic so a 40-item list
// reads as a handful of headings, and narrowed by the search box and the
// status select above -- "what is left to start?" is the question this
// column is usually being asked, and it could not answer it. The column
// is itself a drop target -- that is how a requirement comes back out of a
// sprint. Each row also has "→" to pull it into a sprint: HTML5 drag-and-drop
// has no keyboard story, so the button is the only keyboard-reachable way
// in. Ported from the reference app's spRenderBacklog() and spBacklogRow()
// (static/js/sprints.js).
import { MouseEvent, useRef, useState } from "react";
import { useBoard } from "../board/boardData";
import { numSuffix } from "../board/boardModel";
import { useBoardMutations } from "../board/boardMutations";
import { StatusChip } from "../board/chips";
import { ST_LABEL } from "../board/constants";
import { useDialogs } from "../board/dialogs";
import { useDraggable, useDropTarget } from "../board/dnd";
import { fmtEffort } from "../board/effort";
import type { Epic } from "../board/epicsApi";
import type { Release } from "../board/releasesApi";
import { REQUIREMENT_STATUSES, type Requirement, type RequirementStatus } from "../board/requirementsApi";
import type { Sprint } from "../board/sprintsApi";

interface ReleaseBacklogProps {
  release: Release;
  /** This release's sprints. */
  sprints: Sprint[];
  onOpen: (r: Requirement) => void;
}

interface Group {
  key: string;
  epic: Epic | undefined;
  name: string;
  rows: Requirement[];
}

export function ReleaseBacklog({ release, sprints, onOpen }: ReleaseBacklogProps) {
  const { index, canWrite } = useBoard();
  const mutations = useBoardMutations();
  const ref = useRef<HTMLElement>(null);
  const [query, setQuery] = useState("");
  // "" is every status, not a status of its own.
  const [statusFilter, setStatusFilter] = useState<RequirementStatus | "">("");

  const isOver = useDropTarget(ref, {
    accepts: (d) => d.kind === "requirement" && d.from !== null && d.from !== undefined,
    onDrop: (d) => {
      const r = index.requirementById.get(d.id);
      if (r) void mutations.moveRequirementToSprint(r, null).catch(() => {});
    },
    disabled: !canWrite,
  });

  const all = index.releaseBacklog(release.id).filter((r) => !r.sprint_id);
  const open = sprints.filter((s) => !s.closed_at);
  const q = query.trim().toLowerCase();
  // Grouping runs over the status-filtered rows, so an epic whose work is
  // all Done drops its heading with its rows rather than sitting there empty.
  const inScope = statusFilter ? all.filter((r) => r.status === statusFilter) : all;

  const byEpic = new Map<string, Requirement[]>();
  for (const r of inScope) {
    const eid = index.effectiveEpicId(r) ?? "";
    byEpic.set(eid, [...(byEpic.get(eid) ?? []), r]);
  }
  const seq = (eid: string) => numSuffix(index.epicById.get(eid)?.human_id ?? "");
  // The no-epic group last, the rest in epic order.
  const keys = [...byEpic.keys()].sort((a, b) => Number(a === "") - Number(b === "") || seq(a) - seq(b));
  const groups: Group[] = keys
    .map((key) => {
      const epic = key ? index.epicById.get(key) : undefined;
      const name = key ? index.epicName(key) : "No epic";
      const rows = (byEpic.get(key) ?? [])
        .filter((r) => !q || `${r.human_id} ${r.title} ${epic?.human_id ?? ""} ${name}`.toLowerCase().includes(q))
        .sort((a, b) => numSuffix(a.human_id) - numSuffix(b.human_id));
      return { key, epic, name, rows };
    })
    .filter((g) => g.rows.length > 0);
  const shown = groups.reduce((n, g) => n + g.rows.length, 0);

  return (
    <aside ref={ref} className={`rel-backlog${isOver ? " is-over" : ""}`}>
      <div className="plan-colhead">
        <span>{release.human_id} backlog</span>
        <span className="plan-colhint">drag a requirement onto a sprint</span>
      </div>
      <div className="sp-filters">
        <input className="q2 sp-q" placeholder="filter backlog…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select
          className="mini sp-status"
          aria-label="filter the backlog by status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as RequirementStatus | "")}
        >
          <option value="">Any status</option>
          {REQUIREMENT_STATUSES.map((st) => (
            <option key={st} value={st}>
              {ST_LABEL[st]}
            </option>
          ))}
        </select>
      </div>
      <div>
        {groups.map((g) => (
          <div key={g.key || "none"} className="sp-bl-group">
            <div className="sp-bl-grouphead" title={g.name}>
              {g.epic && <span className="k">{g.epic.human_id}</span>}
              {g.epic ? " " : ""}
              <span className="t">{g.name}</span>
            </div>
            {g.rows.map((r) => (
              <BacklogRow key={r.id} requirement={r} open={open} onOpen={onOpen} />
            ))}
          </div>
        ))}
        {!shown && (
          <div className="hempty">
            {all.length
              ? `${all.length} requirement(s) here, none matching the filter.`
              : `Everything in ${release.human_id} is in a sprint — or nothing is in ${release.human_id} yet. Add epics to it with “＋ Add epic” above, or from the Epics page.`}
          </div>
        )}
        {shown > 0 && shown < all.length && <div className="sp-bl-count">{shown} of {all.length} shown</div>}
      </div>
    </aside>
  );
}

function BacklogRow({ requirement: r, open, onOpen }: { requirement: Requirement; open: Sprint[]; onOpen: (r: Requirement) => void }) {
  const { canWrite } = useBoard();
  const mutations = useBoardMutations();
  const dialogs = useDialogs();
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useDraggable(ref, canWrite ? { kind: "requirement", id: r.id, from: null } : null);

  const pull = async (e: MouseEvent) => {
    e.stopPropagation();
    if (!open.length) return;
    const sid =
      open.length === 1
        ? open[0].id
        : await dialogs.pick({
            title: `Pull ${r.human_id} into…`,
            items: open.map((s) => ({
              value: s.id,
              label: `${s.human_id} · ${s.name}`,
              hint: (s.closed_at ? "closed" : "open") + (s.start_date ? ` · ${s.start_date} → ${s.end_date ?? "—"}` : ""),
            })),
          });
    if (sid) void mutations.moveRequirementToSprint(r, sid).catch(() => {});
  };

  return (
    <div
      ref={ref}
      className={`hrow sp-bl-row${canWrite ? " sp-drag" : ""}${dragging ? " dragging" : ""}`}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        onOpen(r);
      }}
    >
      <span className="k">{r.human_id}</span>
      <span className="t">{r.title}</span>
      <span className={`est-sum${r.estimate_hours == null ? " est-partial" : ""}`}>{fmtEffort(r.estimate_hours)}</span>
      <span className="r">
        <StatusChip status={r.status} />
      </span>
      {canWrite && (
        <button
          type="button"
          className="btn mini-x sp-pull"
          title={open.length ? "pull into a sprint" : "no open sprint in this release yet"}
          disabled={!open.length}
          onClick={(e) => void pull(e)}
        >
          →
        </button>
      )}
    </div>
  );
}
