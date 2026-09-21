// The Roadmap tab -- the board's landing view. One card per release on a
// time axis: its head is the release bar, then one row per sprint filed
// under it (sized by committed-vs-capacity, its agents as chips), then one
// row per epic in it (a bar if its work is in a dated sprint, "no sprint
// yet" otherwise). An EPIC IS PUT INTO A RELEASE here: drag its row onto
// another card, or ⇄ on the row. Every row drills in: release → its page,
// sprint → its board, epic → its page.
//
// A last, dashed card shows up only when something has fallen outside the
// structure -- a sprint under no release, a requirement under no epic. It
// used to list the epics in no release as well; that moved to the Epics
// tab's release filter on 2026-09-18.
//
// Two rules keep this honest, and both are deliberate (see
// timeline/timelineMath.ts): every date comes from a sprint, and hours
// never position anything. A fabricated bar is worse than a visible gap.
// Ported from the reference app's static/js/timeline.js and the
// #timelineView block of static/index.html.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { BoardData, useBoard } from "../board/boardData";
import { useBoardMutations } from "../board/boardMutations";
import { useDialogs } from "../board/dialogs";
import { useDragActive } from "../board/dnd";
import { boardStorageKey, useStoredJson } from "../board/folds";
import { RequirementDrawer } from "../board/RequirementDrawer";
import type { FoldKind, FoldMap, TimelineFolds } from "./timeline/FoldBar";
import { ReleaseCard } from "./timeline/ReleaseCard";
import { tlPct, tlTicks, tlWindow, type TimeWindow } from "./timeline/timelineMath";
import { UnassignedCard } from "./timeline/UnassignedCard";

const FOLD_KINDS: FoldKind[] = ["sprints", "epics"];

export function RoadmapPage() {
  const { projectId, data, error } = useBoard();
  if (!data) {
    return <div className="page board-page muted">{error ? <div className="status-banner warn">{error}</div> : "Loading…"}</div>;
  }
  // Keyed by project so the stored fold preferences are re-read on a switch.
  return <Roadmap key={projectId} data={data} />;
}

function Roadmap({ data }: { data: BoardData }) {
  const { projectId, index, paths, canWrite, error } = useBoard();
  const mutations = useBoardMutations();
  const dialogs = useDialogs();
  const navigate = useNavigate();
  // Tags <body> while an epic row is in flight, so every card outlines as a target.
  useDragActive("epic");

  // ── folding a card's sprints or epics away ──────────────────────────────
  // Per card, per kind, persisted. The viewbar's two buttons set every card
  // at once (the Unassigned card included), the quick "just show me the sprints".
  const [foldMap, setFoldMap] = useStoredJson<FoldMap>(boardStorageKey(projectId, "timelineFold"), {});
  const folds = useMemo<TimelineFolds>(
    () => ({
      folded: (rid, kind) => !!foldMap[rid ?? ""]?.[kind],
      setFold: (rid, kind, v) => {
        const k = rid ?? "";
        setFoldMap((m) => ({ ...m, [k]: { ...(m[k] ?? {}), [kind]: v } }));
      },
    }),
    [foldMap, setFoldMap],
  );
  const foldKeys = [...index.releases.map((r) => r.id), ""];
  const allFolded = (kind: FoldKind) => foldKeys.every((k) => folds.folded(k, kind));
  const setFoldAll = (kind: FoldKind, v: boolean) =>
    setFoldMap((m) => {
      const next: FoldMap = { ...m };
      for (const k of foldKeys) next[k] = { ...(next[k] ?? {}), [kind]: v };
      return next;
    });

  // ── the requirement drawer ──────────────────────────────────────────────
  // A requirement in no epic has no page of its own: a feed link to one
  // lands here as ?req=<id>, and the orphan rows open the same drawer.
  const [params, setParams] = useSearchParams();
  const reqParam = params.get("req");
  const [reqId, setReqId] = useState<string | null>(reqParam);
  useEffect(() => {
    if (reqParam) setReqId(reqParam);
  }, [reqParam]);
  const drawerReq = reqId ? index.requirementById.get(reqId) ?? null : null;
  const closeReq = useCallback(() => {
    setReqId(null);
    if (!params.has("req")) return;
    const next = new URLSearchParams(params);
    next.delete("req");
    setParams(next, { replace: true });
  }, [params, setParams]);

  // ── a new release, then straight to its page to plan sprints ────────────
  const newRelease = async () => {
    const v = await dialogs.form({
      title: "New release",
      ok: "Create",
      fields: [
        { key: "title", label: "Title", required: true, placeholder: "e.g. Design-partner beta" },
        { key: "description", label: "Description", type: "textarea", placeholder: "what ships, and for whom" },
      ],
    });
    if (!v) return;
    try {
      const rel = await mutations.createRelease({ title: v.title, description: v.description ?? "" });
      navigate(paths.release(rel.id));
    } catch {
      // Already toasted by the mutation layer.
    }
  };

  const w = useMemo(() => tlWindow(data.sprints), [data.sprints]);
  const first = index.releases.length ? index.releases[0] : null;
  // The Unfiled card earns its place only when it has something on it, and
  // must still render when nothing on the board is dated yet.
  const hasUnfiled =
    data.requirements.some((r) => index.effectiveEpicId(r) === null) || data.sprints.some((s) => !s.release_id);

  return (
    <div className="page board-page">
      {error && <div className="status-banner warn">{error}</div>}
      <div className="viewbar">
        {canWrite && (
          <button type="button" className="btn" onClick={() => void newRelease()}>
            + New release
          </button>
        )}
        <span className="viewbar-lbl">show</span>
        {FOLD_KINDS.map((kind) => {
          const all = allFolded(kind);
          return (
            <button
              key={kind}
              type="button"
              className={`btn tl-foldall${all ? "" : " on"}`}
              title={`show / hide every release's ${kind}`}
              onClick={() => setFoldAll(kind, !all)}
            >
              {all ? "▸" : "▾"} {kind}
            </button>
          );
        })}
        <span className="viewbar-count">Bars come from sprint dates only.</span>
      </div>

      {w ? (
        <>
          <Axis w={w} />
          {index.releases.map((r) => (
            <ReleaseCard key={r.id} release={r} w={w} folds={folds} />
          ))}
        </>
      ) : (
        <div className="hempty centred">
          <div>
            Nothing is dated yet. Make a release, plan a sprint under it with a start and end, and the roadmap draws itself — every bar
            here comes from real sprint dates, never from a guess.
          </div>
          {first ? (
            <button type="button" className="btn primary" onClick={() => navigate(paths.release(first.id))}>
              Plan sprints for {first.human_id}
            </button>
          ) : canWrite ? (
            <button type="button" className="btn primary" onClick={() => void newRelease()}>
              ＋ New release
            </button>
          ) : null}
        </div>
      )}

      {hasUnfiled && <UnassignedCard w={w} folds={folds} onOpenRequirement={(r) => setReqId(r.id)} />}

      <RequirementDrawer open={drawerReq !== null} requirement={drawerReq} onClose={closeReq} />
    </div>
  );
}

// Month ticks and the today line, sticky above the cards.
function Axis({ w }: { w: TimeWindow }) {
  return (
    <div className="tl-axis">
      <div className="tl-label" />
      <div className="tl-meta" />
      <div className="tl-track">
        {tlTicks(w).map((t) => (
          <i key={`${t.label}-${t.pct}`} className="tl-tick" style={{ left: `${t.pct}%` }}>
            <b>{t.label}</b>
          </i>
        ))}
        <i className="tl-today" style={{ left: `${tlPct(w, Date.now())}%` }}>
          <b>today</b>
        </i>
      </div>
    </div>
  );
}
