// Platform admins: one Kanban of the week's sprint work across every project
// (FS-REQ-101). A requirement is on the board for a week when its sprint's
// dates overlap that week (Monday to Sunday); work with no sprint, archived
// or deleted work never shows. The week travels in the query string
// (`?week=YYYY-MM-DD`, its Monday) so a week can be linked to; the project
// and assignee filters are kept per user in this browser.
//
// A view of existing work: nothing is created here. Dragging a card to
// another lane is the project's own requirement PATCH, sent under the card's
// organisation, so every status rule (blocked_from, the event feed, waking an
// agent) is the sprint board's. A card opens its requirement on its sprint's
// board, which is where the drawer lives.
//
// Looks like the sprint board: the same lanes, cards and drag (board.css,
// board/dnd.ts), without that page's board context, which is per project.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useSession } from "../../app/session";
import { errorMessage } from "../../core/api";
import { MultiSelect, MultiSelectOption } from "../project/board/MultiSelect";
import { ST_ICON, ST_LABEL } from "../project/board/constants";
import { useDraggable, useDropTarget } from "../project/board/dnd";
import { boardPaths } from "../project/board/paths";
import { REQUIREMENT_STATUSES, RequirementStatus, updateRequirement } from "../project/board/requirementsApi";
import { listAllProjects, orgScope } from "../projects/projectsApi";
import { getKanbanWeek, KanbanItem } from "./kanbanApi";
import {
  addDays,
  formatWeek,
  isoDate,
  KanbanFilter,
  matchesFilter,
  mondayOf,
  NO_FILTER,
  parseFilter,
  parseIsoDate,
  UNASSIGNED,
} from "./kanbanModel";

const filterKey = (userId: string) => `ferrous.adminKanban.filter.${userId}`;

function readFilter(userId: string | undefined): KanbanFilter {
  if (!userId) return NO_FILTER;
  try {
    return parseFilter(localStorage.getItem(filterKey(userId)));
  } catch {
    return NO_FILTER;
  }
}

function writeFilter(userId: string | undefined, filter: KanbanFilter): void {
  if (!userId) return;
  try {
    localStorage.setItem(filterKey(userId), JSON.stringify(filter));
  } catch {
    // Storage blocked (a private window): the filter simply is not remembered.
  }
}

export function AdminKanbanPage() {
  const { user, selectOrg } = useSession();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const thisMonday = mondayOf(new Date());
  const monday = mondayOf(parseIsoDate(params.get("week")) ?? thisMonday);
  const week = isoDate(monday);
  const isThisWeek = week === isoDate(thisMonday);
  const goToWeek = (d: Date) =>
    setParams(
      (prev) => {
        const q = new URLSearchParams(prev);
        if (isoDate(d) === isoDate(thisMonday)) q.delete("week");
        else q.set("week", isoDate(d));
        return q;
      },
      { replace: true },
    );

  const [items, setItems] = useState<KanbanItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setItems(null);
    setLoadError(null);
    getKanbanWeek(week)
      .then((w) => live && setItems(w.items))
      .catch((err) => live && setLoadError(errorMessage(err)));
    return () => {
      live = false;
    };
  }, [week]);

  // Every project on the platform, one entry per lineage under its newest
  // version's name, so a project can be picked in a week it has no work.
  const [projects, setProjects] = useState<MultiSelectOption[]>([]);
  useEffect(() => {
    let live = true;
    listAllProjects()
      .then((all) => {
        const newest = new Map<string, (typeof all)[number]>();
        for (const p of all) {
          const seen = newest.get(p.lineage_id);
          if (!seen || p.version_no > seen.version_no) newest.set(p.lineage_id, p);
        }
        const opts = [...newest.values()]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((p) => ({ value: p.lineage_id, label: p.name, hint: p.account_name }));
        if (live) setProjects(opts);
      })
      .catch(() => {
        // The filter falls back to the projects in this week's cards.
      });
    return () => {
      live = false;
    };
  }, []);

  const [filter, setFilterState] = useState<KanbanFilter>(() => readFilter(user?.id));
  useEffect(() => setFilterState(readFilter(user?.id)), [user?.id]);
  const setFilter = (next: KanbanFilter) => {
    setFilterState(next);
    writeFilter(user?.id, next);
  };

  // Options: every project (plus any in this week's cards the listing missed,
  // plus saved picks), and everyone assigned work this week (plus saved picks).
  const projectOptions = useMemo<MultiSelectOption[]>(() => {
    const byId = new Map(projects.map((o) => [o.value, o]));
    for (const it of items ?? []) {
      if (!byId.has(it.lineage_id)) byId.set(it.lineage_id, { value: it.lineage_id, label: it.project_name, hint: it.account_name });
    }
    for (const l of filter.lineages) if (!byId.has(l.id)) byId.set(l.id, { value: l.id, label: l.name });
    return [...byId.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [projects, items, filter.lineages]);
  const assigneeOptions = useMemo<MultiSelectOption[]>(() => {
    const byId = new Map<string, string>();
    for (const it of items ?? []) if (it.assignee) byId.set(it.assignee.id, it.assignee.name);
    for (const a of filter.assignees) if (a.id !== UNASSIGNED && !byId.has(a.id)) byId.set(a.id, a.name);
    return [
      { value: UNASSIGNED, label: "Unassigned" },
      ...[...byId.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label })),
    ];
  }, [items, filter.assignees]);
  const pick = (options: MultiSelectOption[], ids: Set<string>) =>
    options.filter((o) => ids.has(o.value)).map((o) => ({ id: o.value, name: o.label }));

  const all = items ?? [];
  const shown = useMemo(() => all.filter((it) => matchesFilter(it, filter)), [all, filter]);
  const filtering = filter.lineages.length > 0 || filter.assignees.length > 0;

  // A phone has room for one lane (board.css); until one is picked, the first with cards.
  const [chosenLane, setChosenLane] = useState<RequirementStatus | null>(null);
  const phoneLane = chosenLane ?? REQUIREMENT_STATUSES.find((st) => shown.some((r) => r.status === st)) ?? REQUIREMENT_STATUSES[0];

  // Shown in its new lane straight away; put back if the server refuses.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const move = useCallback(async (id: string, status: RequirementStatus) => {
    const it = itemsRef.current?.find((x) => x.id === id);
    if (!it || it.status === status) return;
    const setStatus = (s: RequirementStatus) =>
      setItems((prev) => prev && prev.map((x) => (x.id === id ? { ...x, status: s } : x)));
    setMoveError(null);
    setStatus(status);
    try {
      const saved = await updateRequirement(it.project_id, it.id, { status }, orgScope(it.account_id));
      setStatus(saved.status);
    } catch (err) {
      setStatus(it.status);
      setMoveError(`${it.human_id} could not be moved: ${errorMessage(err)}`);
    }
  }, []);

  // A project's pages are organisation-scoped, so opening one switches the
  // session to that organisation first, as the Projects page does.
  const open = async (it: KanbanItem) => {
    try {
      await selectOrg(it.account_id);
      navigate(boardPaths(it.account_id, it.project_id).sprint(it.sprint.id, { req: it.id }));
    } catch (err) {
      setMoveError(errorMessage(err));
    }
  };

  return (
    <div className="page board-page akb-page">
      <div className="page-head">
        <h1>Kanban</h1>
      </div>

      <div className="viewbar akb-weekbar">
        <button type="button" className="btn mini-x" onClick={() => goToWeek(addDays(monday, -7))} aria-label="Previous week">
          ← Previous
        </button>
        <button type="button" className="btn mini-x" onClick={() => goToWeek(thisMonday)} disabled={isThisWeek}>
          This week
        </button>
        <button type="button" className="btn mini-x" onClick={() => goToWeek(addDays(monday, 7))} aria-label="Next week">
          Next →
        </button>
        <span className="akb-week" aria-live="polite">
          {formatWeek(monday)}
        </span>
        <span className="tk-right">
          <MultiSelect
            allLabel="All projects"
            countLabel="projects"
            ariaLabel="filter by project"
            options={projectOptions}
            selected={new Set(filter.lineages.map((l) => l.id))}
            onChange={(ids) => setFilter({ ...filter, lineages: pick(projectOptions, ids) })}
          />
          <MultiSelect
            allLabel="All assignees"
            countLabel="assignees"
            ariaLabel="filter by assignee"
            options={assigneeOptions}
            selected={new Set(filter.assignees.map((a) => a.id))}
            onChange={(ids) => setFilter({ ...filter, assignees: pick(assigneeOptions, ids) })}
          />
          {filtering && (
            <button type="button" className="btn mini-x" onClick={() => setFilter(NO_FILTER)}>
              Clear
            </button>
          )}
          {items && (
            <span className="viewbar-count">
              {filtering ? `${shown.length} of ${all.length} shown` : `${all.length} this week`}
            </span>
          )}
        </span>
      </div>

      {loadError && <div className="status-banner warn">{loadError}</div>}
      {moveError && <div className="status-banner warn">{moveError}</div>}

      <div className="sb-lanetabs" role="tablist" aria-label="Lane">
        {REQUIREMENT_STATUSES.map((st) => (
          <button
            key={st}
            type="button"
            role="tab"
            aria-selected={st === phoneLane}
            className={st === phoneLane ? "on" : undefined}
            onClick={() => setChosenLane(st)}
          >
            {ST_ICON[st]} {ST_LABEL[st]} <b>{shown.filter((r) => r.status === st).length}</b>
          </button>
        ))}
      </div>
      <div className="sb-layout">
        <section className="sb-board">
          {items === null && !loadError && <div className="hempty sb-empty">Loading…</div>}
          {items && all.length === 0 && <div className="hempty sb-empty">No sprint work this week.</div>}
          {items && all.length > 0 && shown.length === 0 && (
            <div className="hempty sb-empty">Nothing this week matches this filter.</div>
          )}
          {REQUIREMENT_STATUSES.map((st) => (
            <Lane
              key={st}
              status={st}
              current={st === phoneLane}
              items={shown.filter((r) => r.status === st)}
              hidden={all.filter((r) => r.status === st).length - shown.filter((r) => r.status === st).length}
              onMove={move}
              onOpen={open}
            />
          ))}
        </section>
      </div>
    </div>
  );
}

interface LaneProps {
  status: RequirementStatus;
  current: boolean;
  items: KanbanItem[];
  hidden: number;
  onMove: (id: string, status: RequirementStatus) => void;
  onOpen: (it: KanbanItem) => void;
}

function Lane({ status, current, items, hidden, onMove, onOpen }: LaneProps) {
  const ref = useRef<HTMLDivElement>(null);
  const over = useDropTarget(ref, {
    accepts: (d) => d.kind === "card" && d.from !== status,
    // The server stamps blocked_from on a move into Blocked and clears it on
    // the way out, so the patch is the status alone either way.
    onDrop: (d) => onMove(d.id, status),
  });
  return (
    <div ref={ref} className={`sb-col${over ? " is-over" : ""}${current ? " is-current" : ""}`} data-status={status}>
      <h4>
        {ST_ICON[status]} {ST_LABEL[status]} · {items.length}
        {hidden > 0 && <span className="sb-col-hidden"> (+{hidden} hidden)</span>}
      </h4>
      <div className="cards">
        {items.map((it) => (
          <Card key={it.id} item={it} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}

function Card({ item: it, onOpen }: { item: KanbanItem; onOpen: (it: KanbanItem) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useDraggable(ref, { kind: "card", id: it.id, from: it.status });
  const href = boardPaths(it.account_id, it.project_id).sprint(it.sprint.id, { req: it.id });
  return (
    <div ref={ref} className={`reqcard${dragging ? " dragging" : ""}`} onClick={() => onOpen(it)}>
      <div className="k">
        {/* A real link, so it can be opened in a new tab; a plain click goes
            through onOpen, which switches organisation first. */}
        <a
          className="akb-id"
          href={href}
          onClick={(e) => {
            if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) {
              e.stopPropagation();
              return;
            }
            e.preventDefault();
            e.stopPropagation();
            onOpen(it);
          }}
        >
          {it.human_id}
        </a>{" "}
        · <span className={`pri-${it.priority}`}>{it.priority}</span>
      </div>
      <div className="sb-ttl">{it.title}</div>
      <div className="sb-scope">
        <span className="akb-project" title={`${it.project_name} · ${it.account_name} · ${it.sprint.human_id} ${it.sprint.name}`}>
          {it.project_name}
        </span>
        <span className={`akb-assignee${it.assignee ? "" : " is-none"}`} title={it.assignee?.name ?? "Unassigned"}>
          {it.assignee?.name ?? "Unassigned"}
        </span>
      </div>
    </div>
  );
}
